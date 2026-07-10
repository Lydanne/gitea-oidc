import { afterEach, describe, expect, it, vi } from "vitest";
import { GiteaOidcClient } from "../client.js";

describe("GiteaOidcClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends provider request through the SDK proxy", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new GiteaOidcClient({
      baseUrl: "http://localhost:3000/",
      accessToken: "oidc-token",
    });
    const result = await client.providerRequest("feishu", {
      operation: "authen.user_info",
      tokenKind: "user",
    });

    expect(result.data).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/provider/feishu/request",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer oidc-token" }),
      }),
    );
  });
});
