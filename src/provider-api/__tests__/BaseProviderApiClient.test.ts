import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryProviderTokenRepository } from "../../repositories/MemoryProviderTokenRepository";
import type {
  ProviderApiOperationDefinition,
  ProviderTokenRecord,
  ProviderTokenStatus,
} from "../../types/providerApi";
import { BaseProviderApiClient } from "../BaseProviderApiClient";

class TestProviderApiClient extends BaseProviderApiClient {
  constructor(
    repository: MemoryProviderTokenRepository,
    definitions: ProviderApiOperationDefinition[],
    requestTimeoutMs?: number,
    responseBodyLimitBytes?: number,
  ) {
    super({
      provider: "test",
      baseUrl: "https://provider.example/open-apis",
      tokenRepository: repository,
      refreshSkewSeconds: 300,
      requestTimeoutMs,
      responseBodyLimitBytes,
      allowedOperations: definitions.map((definition) => definition.operation),
      operationDefinitions: definitions,
    });
  }

  async getAppToken(ownerId: string = "default"): Promise<ProviderTokenRecord | null> {
    return this.tokenRepository.find(this.provider, "app", ownerId);
  }

  async refreshUserToken(_userId: string): Promise<ProviderTokenRecord> {
    throw new Error("not implemented");
  }

  async probeToken(_record: ProviderTokenRecord): Promise<ProviderTokenStatus> {
    return "unknown";
  }
}

describe("BaseProviderApiClient", () => {
  const fetchMock = vi.fn();
  let repository: MemoryProviderTokenRepository;

  beforeEach(async () => {
    repository = new MemoryProviderTokenRepository();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "application/json"]]),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });

    await repository.upsert({
      provider: "test",
      ownerType: "user",
      ownerId: "user-1",
      accessToken: "provider-access",
      status: "valid",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects reserved caller headers even when an operation declares them", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "test.get",
        method: "GET",
        path: "/test",
        allowedHeaders: [
          "authorization",
          "cookie",
          "forwarded",
          "x-forwarded-port",
          "x-real-ip",
          "x-http-method-override",
          "x-original-url",
          "x-trace-id",
        ],
      },
    ]);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { authorization: "Bearer injected" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { Cookie: "sid=injected" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { Forwarded: "for=192.0.2.1;proto=https" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "X-Forwarded-Port": "443" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "X-Real-IP": "192.0.2.10" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "X-HTTP-Method-Override": "DELETE" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "X-Original-URL": "/admin" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/reserved/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows operation-defined non-reserved headers with safe values", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "test.get",
        method: "GET",
        path: "/test",
        allowedHeaders: ["x-trace-id"],
      },
    ]);

    await client.request(
      {
        tokenKind: "user",
        operation: "test.get",
        headers: { "X-Trace-Id": "trace-1" },
      },
      { userId: "user-1" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/open-apis/test",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: "Bearer provider-access",
          "X-Trace-Id": "trace-1",
        }),
      }),
    );
  });

  it("returns only safe provider response headers to SDK callers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Map([
        ["content-type", "application/json"],
        ["content-language", "zh-CN"],
        ["set-cookie", "provider_session=secret"],
        ["location", "https://provider.example/internal"],
        ["x-request-id", "provider-trace"],
      ]),
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    const client = new TestProviderApiClient(repository, [
      {
        operation: "test.get",
        method: "GET",
        path: "/test",
      },
    ]);

    const result = await client.request(
      { tokenKind: "user", operation: "test.get" },
      { userId: "user-1" },
    );

    expect(result.headers).toEqual({
      "content-type": "application/json",
      "content-language": "zh-CN",
    });
  });

  it("rejects token kinds that are not allowed by the operation definition", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "tenant.get",
        allowedTokenKinds: ["app"],
        method: "GET",
        path: "/tenant",
      },
    ]);

    await expect(
      client.request({ tokenKind: "user", operation: "tenant.get" }, { userId: "user-1" }),
    ).rejects.toThrow(/does not allow user token/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send requests with non-valid provider tokens", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "test.get",
        method: "GET",
        path: "/test",
      },
      {
        operation: "tenant.get",
        allowedTokenKinds: ["app"],
        method: "GET",
        path: "/tenant",
      },
    ]);
    await repository.upsert({
      provider: "test",
      ownerType: "user",
      ownerId: "revoked-user",
      accessToken: "revoked-user-access",
      status: "revoked",
    });
    await repository.upsert({
      provider: "test",
      ownerType: "app",
      ownerId: "default",
      accessToken: "revoked-app-access",
      status: "revoked",
    });

    await expect(
      client.request(
        { tokenKind: "user", operation: "test.get", ownerId: "revoked-user" },
        { userId: "admin-1" },
      ),
    ).rejects.toThrow(/Provider token not found/);

    await expect(
      client.request({ tokenKind: "app", operation: "tenant.get" }, { userId: "admin-1" }),
    ).rejects.toThrow(/Provider token not found/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed caller header names and values", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "test.get",
        method: "GET",
        path: "/test",
        allowedHeaders: ["x-trace-id"],
      },
    ]);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "X-Trace-Id": "trace-1\r\nInjected: yes" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/value is invalid/);

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "test.get",
          headers: { "Bad Header": "trace-1" },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/name is invalid/);
  });

  it("rejects unsafe path template parameters before rendering provider URLs", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "user.get",
        method: "GET",
        path: "/users/{user_id}",
      },
    ]);

    for (const userId of [
      "../admin",
      "..",
      ".",
      "user%2Fadmin",
      "user\\admin",
      "user?debug=true",
      "user#fragment",
    ]) {
      await expect(
        client.request(
          {
            tokenKind: "user",
            operation: "user.get",
            pathParams: { user_id: userId },
          },
          { userId: "user-1" },
        ),
      ).rejects.toThrow(/safe path segment/);
    }

    await expect(
      client.request(
        {
          tokenKind: "user",
          operation: "user.get",
          pathParams: { user_id: Number.NaN },
        },
        { userId: "user-1" },
      ),
    ).rejects.toThrow(/scalar value/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("renders safe path template parameters as a single provider URL segment", async () => {
    const client = new TestProviderApiClient(repository, [
      {
        operation: "user.get",
        method: "GET",
        path: "/users/{user_id}",
      },
    ]);

    await client.request(
      {
        tokenKind: "user",
        operation: "user.get",
        pathParams: { user_id: "ou_1234-abc.def~x" },
      },
      { userId: "user-1" },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/open-apis/users/ou_1234-abc.def~x",
      expect.any(Object),
    );
  });

  it("adds an abort signal to outbound provider requests", async () => {
    const client = new TestProviderApiClient(
      repository,
      [
        {
          operation: "test.get",
          method: "GET",
          path: "/test",
        },
      ],
      1234,
    );

    await client.request({ tokenKind: "user", operation: "test.get" }, { userId: "user-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example/open-apis/test",
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("rejects provider responses over the configured byte limit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ payload: "x".repeat(100) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new TestProviderApiClient(
      repository,
      [
        {
          operation: "test.get",
          method: "GET",
          path: "/test",
        },
      ],
      undefined,
      64,
    );

    await expect(
      client.request({ tokenKind: "user", operation: "test.get" }, { userId: "user-1" }),
    ).rejects.toThrow(/response body is too large/);
  });

  it("rejects provider responses whose declared content length exceeds the byte limit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("{}", {
        status: 200,
        headers: {
          "content-length": "1024",
          "content-type": "application/json",
        },
      }),
    );
    const client = new TestProviderApiClient(
      repository,
      [
        {
          operation: "test.get",
          method: "GET",
          path: "/test",
        },
      ],
      undefined,
      64,
    );

    await expect(
      client.request({ tokenKind: "user", operation: "test.get" }, { userId: "user-1" }),
    ).rejects.toThrow(/response body is too large/);
  });
});
