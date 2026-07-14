import { afterEach, describe, expect, it } from "vitest";
import {
  acquireOidcAccountBlock,
  acquireOidcClientBlock,
  allowOidcAccount,
  allowOidcClient,
  assertOidcAccountWriteAllowed,
  assertOidcClientWriteAllowed,
  clearOidcClientRevocationBarriers,
} from "../oidcClientRevocationBarrier.js";

describe("OIDC Client 撤销栅栏", () => {
  afterEach(() => {
    clearOidcClientRevocationBarriers();
  });

  it("并发租约只能释放自己的封锁", () => {
    const first = acquireOidcClientBlock("client-1");
    const second = acquireOidcClientBlock("client-1");

    second.release();
    expect(() => assertOidcClientWriteAllowed({ clientId: "client-1" })).toThrowError(
      expect.objectContaining({ code: "OIDC_CLIENT_REVOKED" }),
    );

    first.release();
    expect(() => assertOidcClientWriteAllowed({ clientId: "client-1" })).not.toThrow();
  });

  it("多个禁用重试只需一次启用即可移除持久栅栏", () => {
    acquireOidcClientBlock("client-1").commit();
    acquireOidcClientBlock("client-1").commit();

    expect(() => assertOidcClientWriteAllowed({ client_id: "client-1" })).toThrowError(
      expect.objectContaining({ code: "OIDC_CLIENT_REVOKED" }),
    );

    allowOidcClient("client-1");
    expect(() => assertOidcClientWriteAllowed({ client_id: "client-1" })).not.toThrow();
  });

  it("启用不会越过仍在进行的禁用租约", () => {
    acquireOidcClientBlock("client-1").commit();
    const pendingDisable = acquireOidcClientBlock("client-1");

    allowOidcClient("client-1");
    expect(() => assertOidcClientWriteAllowed({ params: { client_id: "client-1" } })).toThrowError(
      expect.objectContaining({ code: "OIDC_CLIENT_REVOKED" }),
    );

    pendingDisable.release();
    expect(() => assertOidcClientWriteAllowed({ params: { client_id: "client-1" } })).not.toThrow();
  });

  it("账户租约会阻止已通过用户校验的请求继续写入", () => {
    const lease = acquireOidcAccountBlock("user-1");

    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).toThrowError(
      expect.objectContaining({ code: "OIDC_ACCOUNT_REVOKED" }),
    );

    lease.release();
    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).not.toThrow();
  });

  it("账户状态提交后保持持久封锁直到显式重新启用", () => {
    acquireOidcAccountBlock("user-1").commit();

    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).toThrowError(
      expect.objectContaining({ code: "OIDC_ACCOUNT_REVOKED" }),
    );

    allowOidcAccount("user-1");
    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).not.toThrow();
  });

  it("释放一个账户租约不会越过其他并发停用操作", () => {
    const first = acquireOidcAccountBlock("user-1");
    const second = acquireOidcAccountBlock("user-1");

    first.release();
    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).toThrowError(
      expect.objectContaining({ code: "OIDC_ACCOUNT_REVOKED" }),
    );

    second.commit();
    allowOidcAccount("user-1");
    expect(() => assertOidcAccountWriteAllowed({ accountId: "user-1" })).not.toThrow();
  });
});
