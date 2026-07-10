import { describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository";
import { Logger } from "../../utils/Logger";
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

  it("uses a bounded probe candidate query when the repository supports it", async () => {
    const token = {
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      status: "valid",
      expiresAt: new Date(Date.now() + 10_000),
    };
    const repository = {
      list: vi.fn(),
      listProbeCandidates: vi.fn().mockResolvedValue([token]),
    };
    const service = { probeToken: vi.fn().mockResolvedValue("valid") };
    const scheduler = new ProviderTokenProbeScheduler({
      providerApiService: service as any,
      tokenRepository: repository as any,
      probeIntervalSeconds: 300,
      refreshSkewSeconds: 300,
      maxTokensPerRun: 2,
    });

    await scheduler.runOnce();

    expect(repository.listProbeCandidates).toHaveBeenCalledWith({
      expiresBefore: expect.any(Date),
      limit: 2,
    });
    expect(repository.list).not.toHaveBeenCalled();
    expect(service.probeToken).toHaveBeenCalledWith("feishu", "user", "user-1");
  });

  it("does not automatically probe locally revoked tokens", async () => {
    const repository = new MemoryProviderTokenRepository();
    await repository.upsert({
      provider: "feishu",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-token",
      status: "revoked",
    });
    const service = { probeToken: vi.fn().mockResolvedValue("valid") };
    const scheduler = new ProviderTokenProbeScheduler({
      providerApiService: service as any,
      tokenRepository: repository,
      probeIntervalSeconds: 300,
      refreshSkewSeconds: 300,
    });

    await scheduler.runOnce();

    expect(service.probeToken).not.toHaveBeenCalled();
  });

  it("redacts token-like values from probe failure logs", async () => {
    const warnSpy = vi.spyOn(Logger, "warn").mockImplementation(() => {});
    const repository = new MemoryProviderTokenRepository();
    await repository.upsert({
      provider: "feishu",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "access",
      status: "valid",
    });
    const service = {
      probeToken: vi
        .fn()
        .mockRejectedValue(new Error("failed with Authorization: Bearer provider-token")),
    };
    const scheduler = new ProviderTokenProbeScheduler({
      providerApiService: service as any,
      tokenRepository: repository,
      probeIntervalSeconds: 300,
      refreshSkewSeconds: 300,
    });

    await scheduler.runOnce();

    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider-token");
    warnSpy.mockRestore();
  });
});
