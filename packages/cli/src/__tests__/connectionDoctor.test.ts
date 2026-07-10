import { describe, expect, it, vi } from "vitest";
import { readConnectionFile, redactConnection } from "../connectionFile.js";
import { runDoctor } from "../doctor.js";
import {
  connection,
  createDependencies,
  createDiscoveryResponse,
  validDiscovery,
} from "./fixtures.js";

describe("connection file", () => {
  it("validates the strict connection contract and redacts identifiers", async () => {
    const dependencies = createDependencies();

    const parsed = await readConnectionFile(dependencies.fileSystem, "/connection.json");
    const redacted = redactConnection(parsed);

    expect(parsed).toEqual(connection);
    expect(redacted).toMatchObject({
      applicationId: "[REDACTED]",
      oidcClientId: "[REDACTED]",
      clientId: "[REDACTED]",
      redirectUris: ["https://app.example.com/oidc/callback"],
      postLogoutRedirectUris: ["https://app.example.com/logout/callback"],
    });
  });

  it("rejects a secret embedded in the connection without echoing it", async () => {
    const dependencies = createDependencies();
    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(
      JSON.stringify({ ...connection, clientSecret: "must-never-be-printed" }),
    );

    const error = await readConnectionFile(dependencies.fileSystem, "/connection.json").catch(
      (caught) => caught,
    );

    expect(String(error)).toContain("连接配置校验失败");
    expect(String(error)).not.toContain("must-never-be-printed");
  });

  it("does not echo an attacker-controlled unknown property name", async () => {
    const dependencies = createDependencies();
    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(
      JSON.stringify({ ...connection, "secret-value-as-property-name": true }),
    );

    const error = await readConnectionFile(dependencies.fileSystem, "/connection.json").catch(
      (caught) => caught,
    );

    expect(String(error)).toContain("连接配置校验失败");
    expect(String(error)).not.toContain("secret-value-as-property-name");
  });
});

describe("doctor", () => {
  it("checks discovery, exact issuer and same-origin HTTPS endpoints", async () => {
    const dependencies = createDependencies();
    dependencies.httpClient.fetch.mockResolvedValue(
      createDiscoveryResponse(validDiscovery, {
        url: "https://id.example.com/.well-known/openid-configuration",
      }),
    );

    const result = await runDoctor(connection, dependencies, {
      allowPrivateNetwork: false,
      timeoutMs: 2_000,
    });

    expect(result.checks).toEqual(["discovery", "issuer", "endpoints"]);
    expect(dependencies.httpClient.fetch).toHaveBeenCalledWith(
      "https://id.example.com/.well-known/openid-configuration",
      expect.objectContaining({
        headers: { accept: "application/json" },
        redirect: "manual",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(dependencies.dnsResolver.resolve).toHaveBeenCalledTimes(2);
  });

  it("resolves an IPv6 issuer literal without URL brackets", async () => {
    const dependencies = createDependencies({ dnsAddresses: ["2606:4700:4700::1111"] });
    const issuer = "https://[2606:4700:4700::1111]";
    dependencies.httpClient.fetch.mockResolvedValue(
      createDiscoveryResponse({
        issuer,
        authorization_endpoint: `${issuer}/oidc/auth`,
        token_endpoint: `${issuer}/oidc/token`,
        jwks_uri: `${issuer}/oidc/jwks`,
      }),
    );

    await expect(
      runDoctor({ ...connection, issuer }, dependencies, {
        allowPrivateNetwork: false,
        timeoutMs: 2_000,
      }),
    ).resolves.toMatchObject({ checks: ["discovery", "issuer", "endpoints"] });
    expect(dependencies.dnsResolver.resolve).toHaveBeenCalledWith("2606:4700:4700::1111");
  });

  it("rejects an issuer mismatch", async () => {
    const dependencies = createDependencies();
    dependencies.httpClient.fetch.mockResolvedValue(
      createDiscoveryResponse({ ...validDiscovery, issuer: "https://other.example.com" }),
    );

    await expect(
      runDoctor(connection, dependencies, { allowPrivateNetwork: false, timeoutMs: 2_000 }),
    ).rejects.toThrow("不精确匹配");
  });

  it("rejects cross-origin or insecure endpoints", async () => {
    const dependencies = createDependencies();
    dependencies.httpClient.fetch.mockResolvedValue(
      createDiscoveryResponse({
        ...validDiscovery,
        token_endpoint: "https://tokens.example.net/token",
      }),
    );

    await expect(
      runDoctor(connection, dependencies, { allowPrivateNetwork: false, timeoutMs: 2_000 }),
    ).rejects.toThrow("token_endpoint 必须与 issuer 同源");

    dependencies.httpClient.fetch.mockResolvedValue(
      createDiscoveryResponse({
        ...validDiscovery,
        jwks_uri: "http://id.example.com/jwks",
      }),
    );
    await expect(
      runDoctor(connection, dependencies, { allowPrivateNetwork: false, timeoutMs: 2_000 }),
    ).rejects.toThrow("jwks_uri 必须与 issuer 同源");
  });

  it("aborts a discovery request after the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = createDependencies();
      dependencies.httpClient.fetch.mockImplementation(
        async (_url, init) =>
          await new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          }),
      );

      const result = expect(
        runDoctor(connection, dependencies, {
          allowPrivateNetwork: false,
          timeoutMs: 250,
        }),
      ).rejects.toThrow("250ms 后超时");
      await vi.advanceTimersByTimeAsync(250);

      await result;
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the deadline to body reads and cancels a stalled response", async () => {
    vi.useFakeTimers();
    try {
      const dependencies = createDependencies();
      const response = createDiscoveryResponse(validDiscovery);
      response.readText.mockImplementation(async () => await new Promise(() => undefined));
      dependencies.httpClient.fetch.mockResolvedValue(response);

      const result = expect(
        runDoctor(connection, dependencies, {
          allowPrivateNetwork: false,
          timeoutMs: 250,
        }),
      ).rejects.toThrow("250ms 后超时");
      await vi.advanceTimersByTimeAsync(250);

      await result;
      expect(response.cancel).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects private DNS results unless explicitly allowed", async () => {
    const dependencies = createDependencies({ dnsAddresses: ["127.0.0.1"] });
    dependencies.httpClient.fetch.mockResolvedValue(createDiscoveryResponse(validDiscovery));

    await expect(
      runDoctor(connection, dependencies, { allowPrivateNetwork: false, timeoutMs: 2_000 }),
    ).rejects.toThrow("--allow-private-network");
    expect(dependencies.httpClient.fetch).not.toHaveBeenCalled();

    await expect(
      runDoctor(connection, dependencies, { allowPrivateNetwork: true, timeoutMs: 2_000 }),
    ).resolves.toMatchObject({ checks: ["discovery", "issuer", "endpoints"] });
  });
});
