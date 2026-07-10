import { afterEach, describe, expect, it } from "vitest";
import {
  acquireOidcClientBlock,
  allowOidcClient,
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
});
