import { describe, expect, it } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository.js";
import { DingTalkProviderApiClient } from "../DingTalkProviderApiClient.js";

describe("DingTalkProviderApiClient", () => {
  const createClient = () =>
    new DingTalkProviderApiClient({
      tokenRepository: new MemoryProviderTokenRepository(),
      baseUrl: "https://api.dingtalk.com",
      refreshSkewSeconds: 300,
      allowedOperations: [],
    });

  it("returns explicit not implemented errors for token operations", async () => {
    const client = createClient();

    await expect(client.getAppToken()).rejects.toThrow(/not implemented/);
    await expect(client.refreshUserToken("user-1")).rejects.toThrow(/not implemented/);
    await expect(
      client.probeToken({
        provider: "dingtalk",
        ownerType: "user",
        ownerId: "user-1",
        accessToken: "token",
        status: "unknown",
      }),
    ).rejects.toThrow(/not implemented/);
  });
});
