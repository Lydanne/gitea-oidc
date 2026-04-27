import { describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository";
import { ProviderTokenProbeScheduler } from "../ProviderTokenProbeScheduler";

describe("ProviderTokenProbeScheduler", () => {
  it("probes tokens that are expiring soon", async () => {
    const repository = new MemoryProviderTokenRepository();
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      expiresAt: new Date(Date.now() + 10_000),
      status: "valid",
    });
    const service = { probeToken: vi.fn().mockResolvedValue("valid") };
    const scheduler = new ProviderTokenProbeScheduler({
      providerApiService: service as any,
      tokenRepository: repository,
      probeIntervalSeconds: 300,
      refreshSkewSeconds: 300,
    });

    await scheduler.runOnce();

    expect(service.probeToken).toHaveBeenCalledWith("feishu", "user", "user-1");
  });
});
