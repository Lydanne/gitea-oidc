import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { afterEach, describe, expect, it } from "vitest";
import { OidcAdapterFactory } from "../OidcAdapterFactory.js";

const clients: ReturnType<typeof createClient>[] = [];
afterEach(async () => {
  await OidcAdapterFactory.cleanup();
  for (const client of clients.splice(0)) if (client.isOpen) await client.quit();
});

const setup = async () => {
  const prefix = `review:[${randomUUID()}]:`;
  const client = createClient({ url: process.env.REDIS_TEST_URL });
  clients.push(client);
  await client.connect();
  OidcAdapterFactory.configure({
    type: "redis",
    redis: { url: process.env.REDIS_TEST_URL, keyPrefix: prefix },
  });
  return { prefix, client };
};

describe.skipIf(!process.env.REDIS_TEST_URL)("Redis 账户与 Interaction 撤销", () => {
  it("对多账户 Interaction 的每个关联建立索引，改写和销毁也清理全部账户索引", async () => {
    const { client, prefix } = await setup();
    const interaction = OidcAdapterFactory.create("Interaction")!;
    const payload = {
      accountId: "top",
      result: { login: { accountId: "new" } },
      lastSubmission: { login: { accountId: "submitted" } },
      session: { accountId: "old" },
    };
    await interaction.upsert("multi", payload, 60);
    for (const accountId of ["top", "new", "submitted", "old"]) {
      expect(await client.sMembers(`${prefix}accountId:${accountId}`)).toContain(
        "Interaction:multi",
      );
      const lease = await OidcAdapterFactory.acquireAccountIdBlock(accountId);
      await expect(interaction.upsert("late", payload, 60)).rejects.toMatchObject({
        code: "OIDC_ACCOUNT_REVOKED",
      });
      await lease.release();
    }
    await interaction.upsert("multi", { accountId: "top", session: { accountId: "old" } }, 60);
    expect(await client.sMembers(`${prefix}accountId:new`)).toEqual([]);
    expect(await client.sMembers(`${prefix}accountId:submitted`)).toEqual([]);
    await interaction.destroy("multi");
    expect(await client.sMembers(`${prefix}accountId:top`)).toEqual([]);
    expect(await client.sMembers(`${prefix}accountId:old`)).toEqual([]);
  });

  it("增量清理升级前没有账户索引的嵌套 Interaction，恢复账号后旧记录仍不可读", async () => {
    const { client, prefix } = await setup();
    const interaction = OidcAdapterFactory.create("Interaction")!;
    const legacy = [
      { result: { login: { accountId: "victim" } }, uid: "old-uid" },
      { lastSubmission: { login: { accountId: "victim" } } },
      { session: { accountId: "victim" }, result: { login: { accountId: "other" } } },
      { accountId: "other", result: { login: { accountId: "victim" } } },
    ];
    for (const [index, payload] of legacy.entries()) {
      await client.setEx(`${prefix}Interaction:legacy-${index}`, 60, JSON.stringify(payload));
    }
    await client.setEx(`${prefix}uid:old-uid`, 60, "legacy-0");
    // SCAN 也可能返回模型下的集合索引，必须跳过非字符串，不触发 WRONGTYPE。
    await client.sAdd(`${prefix}Interaction:grantId:old-grant`, "legacy-0");
    await interaction.upsert("unrelated", { result: { login: { accountId: "other" } } }, 60);
    // 模拟历史留下的脏索引，撤销时不能误删实际已属于另一账户的记录。
    await client.sAdd(`${prefix}accountId:victim`, "Interaction:unrelated");
    const lease = await OidcAdapterFactory.acquireAccountIdBlock("victim");
    await OidcAdapterFactory.revokeByAccountId("victim");
    await lease.commit();
    await OidcAdapterFactory.allowAccountId("victim");
    for (const index of legacy.keys())
      expect(await interaction.find(`legacy-${index}`)).toBeUndefined();
    expect(await client.get(`${prefix}uid:old-uid`)).toBeNull();
    expect(await interaction.find("unrelated")).toBeDefined();
    await interaction.upsert("fresh", { result: { login: { accountId: "victim" } } }, 60);
    expect(await interaction.find("fresh")).toBeDefined();
  });

  it("撤销原 Grant 后不能用恢复的账户写入迟到 Token，Client 或账户错配也拒绝", async () => {
    const { client, prefix } = await setup();
    const grants = OidcAdapterFactory.create("Grant")!;
    const tokens = OidcAdapterFactory.create("AccessToken")!;
    const payload = { accountId: "victim", clientId: "client", grantId: "grant" };
    await expect(tokens.upsert("missing", payload, 60)).rejects.toMatchObject({
      code: "OIDC_GRANT_REVOKED",
    });
    await grants.upsert("grant", { accountId: "other", clientId: "client" }, 60);
    await expect(tokens.upsert("wrong-account", payload, 60)).rejects.toMatchObject({
      code: "OIDC_GRANT_REVOKED",
    });
    await grants.upsert("grant", { accountId: "victim", clientId: "other" }, 60);
    await expect(tokens.upsert("wrong-client", payload, 60)).rejects.toMatchObject({
      code: "OIDC_GRANT_REVOKED",
    });
    await grants.upsert("grant", { accountId: "victim", clientId: "client" }, 60);
    await tokens.upsert("valid", payload, 60);
    const lease = await OidcAdapterFactory.acquireAccountIdBlock("victim");
    await OidcAdapterFactory.revokeByAccountId("victim");
    await lease.commit();
    await OidcAdapterFactory.allowAccountId("victim");
    await expect(tokens.upsert("late", payload, 60)).rejects.toMatchObject({
      code: "OIDC_GRANT_REVOKED",
    });
    expect(await client.exists(`${prefix}AccessToken:late`)).toBe(0);
    // Client credentials 没有用户和用户 Grant，不应被新约束误伤。
    await tokens.upsert("client-only", { clientId: "client", grantId: "unrelated" }, 60);
    expect(await tokens.find("client-only")).toBeDefined();
  });
});
