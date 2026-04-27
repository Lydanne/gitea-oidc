import { afterEach, describe, expect, it, vi } from "vitest";
import { useProviderRequest } from "../vue";

describe("useProviderRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tracks loading and returns Provider API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ status: 200, headers: {}, data: { ok: true } }),
      }),
    );
    const api = useProviderRequest({
      baseUrl: "https://id.example.com",
      accessToken: "oidc-token",
    });

    const pending = api.request("feishu", {
      method: "GET",
      path: "/authen/v1/user_info",
      tokenKind: "user",
    });
    expect(api.loading.value).toBe(true);

    await expect(pending).resolves.toMatchObject({ data: { ok: true } });
    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();
  });
});
