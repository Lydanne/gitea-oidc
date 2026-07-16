import { describe, expect, it, vi } from "vitest";
import {
  DistributedPortalSessionStore,
  PortalLoginStateLimitError,
  PortalSessionStore,
} from "../PortalSessionStore.js";

describe("PortalSessionStore", () => {
  it("creates independent sessions and expires them", () => {
    vi.useFakeTimers();
    try {
      const store = new PortalSessionStore(60);
      const session = store.createSession("user-1");
      expect(store.getSession(session.id)).toMatchObject({ userId: "user-1" });

      vi.advanceTimersByTime(60_001);
      expect(store.getSession(session.id)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("consumes browser-bound login state only once", () => {
    const store = new PortalSessionStore(3600);
    const state = store.createLoginState("/portal", "binding-hash", "code-verifier");

    expect(store.consumeLoginState(state)).toEqual({
      returnTo: "/portal",
      bindingHash: "binding-hash",
      codeVerifier: "code-verifier",
    });
    expect(store.consumeLoginState(state)).toBeNull();
  });

  it("rate limits repeated login starts", () => {
    const store = new PortalSessionStore(3600, 600, 100, 100, 1, 60);
    store.checkLoginRateLimit(["source:one", "browser:one"]);
    expect(() => store.checkLoginRateLimit(["source:one"])).toThrow(PortalLoginStateLimitError);
  });
});

describe("DistributedPortalSessionStore", () => {
  it("uses a portal namespace and atomically consumes shared state", async () => {
    const bindingHash = "a".repeat(64);
    const codeVerifier = "b".repeat(64);
    const stateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue({
        id: "session-1",
        userId: "user-1",
        expiresAt: Date.now() + 60_000,
      }),
      take: vi.fn().mockResolvedValue({
        returnTo: "/portal",
        bindingHash,
        codeVerifier,
      }),
      setBounded: vi.fn().mockResolvedValue(true),
      increment: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const store = new DistributedPortalSessionStore(stateStore as any, 3600);

    const session = await store.createSession("user-1");
    expect(stateStore.set).toHaveBeenCalledWith(
      `portal:session:${session.id}`,
      expect.objectContaining({ userId: "user-1" }),
      3600,
    );

    const state = await store.createLoginState("/portal", bindingHash, codeVerifier);
    expect(stateStore.setBounded).toHaveBeenCalledWith(
      `portal:login-state:${state}`,
      {
        returnTo: "/portal",
        bindingHash,
        codeVerifier,
      },
      600,
      "portal:login-states",
      1000,
    );
    expect(await store.consumeLoginState(state)).toEqual({
      returnTo: "/portal",
      bindingHash,
      codeVerifier,
    });
    expect(stateStore.take).toHaveBeenCalledWith(
      `portal:login-state:${state}`,
      "portal:login-states",
    );
  });

  it("uses shared counters to rate limit every source and browser key", async () => {
    const stateStore = {
      increment: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
    };
    const store = new DistributedPortalSessionStore(stateStore as any, 3600, 600, 1000, 1, 60);

    await expect(store.checkLoginRateLimit(["source:one", "browser:one"])).rejects.toThrow(
      PortalLoginStateLimitError,
    );
    expect(stateStore.increment).toHaveBeenCalledTimes(2);
    expect(stateStore.increment.mock.calls[0]?.[0]).toMatch(/^portal:login-start-rate:/u);
  });

  it("rejects malformed shared sessions instead of trusting Redis data", async () => {
    const stateStore = {
      get: vi.fn().mockResolvedValue({ userId: "user-1", expiresAt: "never" }),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const store = new DistributedPortalSessionStore(stateStore as any, 3600);

    await expect(store.getSession("attacker-controlled-id")).resolves.toBeNull();
    expect(stateStore.delete).toHaveBeenCalledWith("portal:session:attacker-controlled-id");
  });
});
