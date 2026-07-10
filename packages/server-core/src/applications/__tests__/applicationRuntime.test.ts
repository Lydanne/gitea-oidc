import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { GiteaOidcConfig } from "../../config.js";
import { createApplicationRuntime } from "../applicationRuntime.js";

function createRuntimeConfig(tempDir: string): GiteaOidcConfig {
  const masterKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 41));
  return {
    server: { url: "https://id.example.com" },
    oidc: {
      issuer: "https://id.example.com/oidc",
      claims: {
        openid: ["sub"],
        profile: ["name"],
        email: ["email", "email_verified"],
      },
    },
    clients: [
      {
        client_id: "system-admin",
        client_secret: "system-client-secret-value",
        redirect_uris: ["https://id.example.com/admin/callback"],
        response_types: ["code"],
        grant_types: ["authorization_code"],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
    providerApi: { enabled: false, allowedClientIds: [] },
    applications: {
      enabled: true,
      clientSource: "database",
      repository: { type: "sqlite", sqlite: { dbPath: join(tempDir, "applications.db") } },
      secretEncryption: {
        keyId: "applications-v1",
        masterKey: masterKey.toString("base64url"),
      },
    },
  } as GiteaOidcConfig;
}

describe("createApplicationRuntime", () => {
  it("重启后恢复未完成的禁用并且不会重复推进状态", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitea-oidc-application-runtime-"));
    const config = createRuntimeConfig(tempDir);
    let firstRuntime: Awaited<ReturnType<typeof createApplicationRuntime>>;
    let secondRuntime: Awaited<ReturnType<typeof createApplicationRuntime>>;

    try {
      firstRuntime = await createApplicationRuntime(config);
      expect(firstRuntime).toBeDefined();
      const created = (await firstRuntime!.applicationService.createCustomApplication(
        {
          schemaVersion: 1,
          application: {
            name: "恢复测试应用",
            environment: "production",
          },
          client: {
            clientType: "confidential",
            redirectUris: ["https://app.example.com/callback"],
          },
          credentialDelivery: "direct",
        },
        {
          idempotencyKey: "runtime-recovery-create",
          actor: { type: "user", id: "admin-1" },
        },
      )) as any;
      const applicationId = created.response.application.id as string;
      const clientId = created.response.client.clientId as string;
      await firstRuntime!.applicationService.disableApplication(applicationId, {
        expectedVersion: 1,
        actor: { type: "user", id: "admin-1" },
      });
      await firstRuntime!.close();
      firstRuntime = undefined;

      secondRuntime = await createApplicationRuntime(config);
      expect(secondRuntime).toBeDefined();
      const revoke = vi.fn().mockResolvedValue(undefined);

      await secondRuntime!.recoverPendingDisables(revoke);

      expect(revoke).toHaveBeenCalledWith(clientId);
      const details = (await secondRuntime!.applicationService.getApplication(
        applicationId,
      )) as any;
      expect(details.application).toMatchObject({ status: "disabled", version: 3 });
      const audit = (await secondRuntime!.applicationService.listAuditEvents(
        applicationId,
      )) as any[];
      expect(audit.map((event) => event.type)).toEqual([
        "application.created",
        "client_secret.created",
        "application.disable_started",
        "application.disabled",
      ]);
      expect(audit.at(-1)?.actor).toEqual({ type: "system" });

      await secondRuntime!.recoverPendingDisables(revoke);
      expect(revoke).toHaveBeenCalledTimes(1);
    } finally {
      await firstRuntime?.close();
      await secondRuntime?.close();
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
