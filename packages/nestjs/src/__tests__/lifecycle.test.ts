import { createWebConnectorCore, type WebConnectorCore } from "@gitea-oidc/connector-core";
import type { NodeOidcClient } from "@gitea-oidc/node";
import type { HttpAdapterHost } from "@nestjs/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NestOidcService } from "../nestOidcService.js";

vi.mock("@gitea-oidc/connector-core", async (importOriginal) => {
  const original = await importOriginal<typeof import("@gitea-oidc/connector-core")>();
  return { ...original, createWebConnectorCore: vi.fn() };
});

const closeCore = vi.fn(async () => {});

const fakeCore = { close: closeCore } as unknown as WebConnectorCore;
const adapterHost = {} as HttpAdapterHost;

describe("NestOidcService lifecycle", () => {
  beforeEach(() => {
    vi.mocked(createWebConnectorCore).mockReturnValue(fakeCore);
    closeCore.mockClear();
  });

  it("closes an internally owned Node client exactly once", async () => {
    const service = new NestOidcService(
      {
        clientOptions: {} as never,
        redirectUri: "https://app.example.com/oidc/callback",
      },
      adapterHost,
    );

    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    expect(closeCore).toHaveBeenCalledOnce();
  });

  it("closes the connector once even when its Node client is injected", async () => {
    const service = new NestOidcService(
      {
        client: {} as NodeOidcClient,
        redirectUri: "https://app.example.com/oidc/callback",
      },
      adapterHost,
    );

    await service.close();
    await service.onApplicationShutdown();

    expect(closeCore).toHaveBeenCalledOnce();
  });
});
