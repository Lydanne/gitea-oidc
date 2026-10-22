import Fastify from "fastify";
import type { Provider } from "oidc-provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryUserRepository } from "../../repositories/MemoryUserRepository.js";
import {
  DistributedBffSessionRevocations,
  MemoryBffSessionRevocations,
} from "../../sessions/BffSessionRevocations.js";
import { MemoryStateStore } from "../../stores/MemoryStateStore.js";
import type { AuthContext, AuthProvider } from "../../types/auth.js";
import { AuthCoordinator } from "../AuthCoordinator.js";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function setup(distributed = false) {
  const app = Fastify();
  const stateStore = new MemoryStateStore();
  const userRepository = new MemoryUserRepository();
  const revocations = distributed
    ? new DistributedBffSessionRevocations(stateStore, 600)
    : new MemoryBffSessionRevocations(600);
  const coordinator = new AuthCoordinator({
    app,
    stateStore,
    userRepository,
    providersConfig: {},
    authenticationRevocations: revocations,
  });
  cleanup.push(
    () => app.close(),
    () => stateStore.destroy(),
  );
  const createUser = () =>
    userRepository.findOrCreate("feishu", "external-1", {
      username: "test-user",
      name: "Test",
      email: "test@example.com",
      status: "active",
    });
  async function revoke(userId: string) {
    await (await revocations.blockUser(userId)).commit();
    await revocations.allowUser(userId);
  }
  return { app, stateStore, userRepository, coordinator, createUser, revoke };
}

for (const distributed of [false, true]) {
  describe(`${distributed ? "shared" : "memory"} authentication lifecycle`, () => {
    it("正常认证结果只可消费一次，旧 OAuth state 和旧认证结果在恢复后失效", async () => {
      const { coordinator, createUser, revoke } = setup(distributed);
      const user = await createUser();
      const generation = await coordinator.captureAuthenticationGeneration();
      await coordinator.storeAuthResult("fresh", user.sub, undefined, generation);
      expect(await coordinator.getAuthResult("fresh")).toBe(user.sub);
      expect(await coordinator.getAuthResult("fresh")).toBeNull();
      const state = await coordinator.generateOAuthState("interaction-1", "feishu");
      await coordinator.storeAuthResult("old", user.sub, undefined, generation);
      await revoke(user.sub);
      expect(await coordinator.verifyOAuthState(state)).toBeNull();
      expect(await coordinator.consumeAuthResult("old")).toBeNull();
      await expect(
        coordinator.storeAuthResult("late", user.sub, undefined, generation),
      ).rejects.toThrow();
      const next = await coordinator.captureAuthenticationGeneration();
      await coordinator.storeAuthResult("next", user.sub, undefined, next);
      expect(await coordinator.getAuthResult("next")).toBe(user.sub);
    });

    it("同 sub 重建或停用账号不能消费旧认证结果，旧版本无代际结果也失败关闭", async () => {
      const { coordinator, userRepository, stateStore, createUser } = setup(distributed);
      const user = await createUser();
      const generation = await coordinator.captureAuthenticationGeneration();
      await coordinator.storeAuthResult("deleted", user.sub, undefined, generation);
      await userRepository.delete(user.sub);
      const replacement = await createUser();
      expect(replacement.sub).toBe(user.sub);
      expect(replacement.id).not.toBe(user.id);
      expect(await coordinator.consumeAuthResult("deleted")).toBeNull();
      await coordinator.storeAuthResult("disabled", replacement.sub, undefined, generation);
      await userRepository.update(replacement.sub, { status: "disabled" });
      expect(await coordinator.consumeAuthResult("disabled")).toBeNull();
      await stateStore.set(
        "auth_result_legacy",
        {
          type: "auth_result",
          userId: user.sub,
          timestamp: Date.now(),
        },
        300,
      );
      expect(await coordinator.consumeAuthResult("legacy")).toBeNull();
    });

    it("凭据校验暂停期间发生撤销，认证失败且不能完成 Interaction", async () => {
      const { coordinator, createUser, revoke } = setup(distributed);
      const user = await createUser();
      let finish!: () => void;
      let entered!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const paused = new Promise<void>((resolve) => {
        finish = resolve;
      });
      coordinator.registerProvider({
        name: "test",
        displayName: "test",
        canHandle: () => true,
        authenticate: async () => {
          entered();
          await paused;
          return { success: true, userId: user.sub };
        },
      } as AuthProvider);
      const authenticating = coordinator.handleAuthentication({
        authMethod: "test",
        body: {},
        request: { headers: {}, ip: "127.0.0.1" },
      } as AuthContext);
      await enteredPromise;
      await revoke(user.sub);
      finish();
      expect((await authenticating).success).toBe(false);
      const interactionFinished = vi.fn();
      coordinator.setOidcProvider({ interactionFinished } as unknown as Provider);
      await expect(
        coordinator.finishOidcInteraction(
          { raw: {} } as never,
          { raw: {} } as never,
          "uid",
          user.sub,
        ),
      ).rejects.toThrow();
      expect(interactionFinished).not.toHaveBeenCalled();
    });

    it("迟到的 Interaction 持久化仍携带旧代际，恢复后的 resume 验证拒绝它", async () => {
      const { coordinator, createUser, revoke } = setup(distributed);
      const user = await createUser();
      const generation = await coordinator.captureAuthenticationGeneration();
      const interactionFinished = vi.fn(async (_req, _res, result) => {
        await revoke(user.sub);
        return result;
      });
      coordinator.setOidcProvider({ interactionFinished } as unknown as Provider);
      await coordinator.finishOidcInteraction(
        { raw: {} } as never,
        { raw: {} } as never,
        "uid",
        user.sub,
        generation,
      );
      const result = interactionFinished.mock.calls[0][2];
      await expect(
        coordinator.validateInteractionAuthentication(result.x_oidc_authentication, user.sub),
      ).rejects.toThrow();
      const fresh = await coordinator.createInteractionAuthentication(
        await coordinator.captureAuthenticationGeneration(),
        user.sub,
      );
      await expect(
        coordinator.validateInteractionAuthentication(fresh, user.sub),
      ).resolves.toBeUndefined();
    });
  });
}
