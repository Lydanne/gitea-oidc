import "reflect-metadata";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  Bind,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  type INestApplication,
  Inject,
  Injectable,
  Module,
  Req,
  UseGuards,
} from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { AuthSessionView, NodeOidcClient } from "@x-oidc/node";
import { NodeOidcError } from "@x-oidc/node";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NestOidcModule,
  NestOidcOptionalAuthGuard,
  NestOidcRequiredAuthGuard,
  NestOidcService,
  OidcAuth,
  OptionalOidcAuth,
} from "../index.js";

const NOW = Date.parse("2026-07-10T08:00:00.000Z");
const TRANSACTION_ID = "t".repeat(43);
const SESSION_ID = "s".repeat(43);
const COOKIE_NAMESPACE = createHash("sha256")
  .update("https://app.example.com")
  .digest("base64url")
  .slice(0, 16);
const TRANSACTION_COOKIE_NAME = `__Host-x_oidc_transaction_${COOKIE_NAMESPACE}`;
const SESSION_COOKIE_NAME = `__Host-x_oidc_session_${COOKIE_NAMESPACE}`;

const session: AuthSessionView = Object.freeze({
  authenticated: true,
  user: Object.freeze({ subject: "user-1", name: "示例用户" }),
  scopes: Object.freeze(["openid", "profile"]),
  canRefresh: false,
  createdAt: "2026-07-10T08:00:00.000Z",
  expiresAt: "2026-07-10T09:00:00.000Z",
});

const createClient = () =>
  ({
    beginLogin: vi.fn(async () => ({
      authorizationUrl: "https://id.example.com/authorize?state=server-state",
      transactionId: TRANSACTION_ID,
      expiresAt: "2026-07-10T08:10:00.000Z",
    })),
    completeCallback: vi.fn(async () => ({
      sessionId: SESSION_ID,
      session,
      returnTo: "/dashboard",
    })),
    getSession: vi.fn(async () => session),
    refreshSession: vi.fn(async () => session),
    logout: vi.fn(async () => ({
      logoutUrl: "https://id.example.com/session/end",
      warnings: [] as const,
    })),
    close: vi.fn(async () => {}),
  }) satisfies NodeOidcClient;

type TestPlatform = "express" | "fastify";

interface Fixture {
  readonly app: INestApplication;
  readonly baseUrl: string;
  readonly client: ReturnType<typeof createClient>;
  readonly shutdownGate: {
    readonly started: Promise<void>;
    release(): void;
  };
}

const applications = new Set<INestApplication>();

const createFixture = async (
  platform: TestPlatform,
  asyncRegistration = false,
): Promise<Fixture> => {
  const client = createClient();
  const options = {
    client,
    redirectUri: "https://app.example.com/oidc/callback",
    postLogoutRedirectUri: "https://app.example.com/signed-out",
    clock: () => NOW,
  } as const;
  let releaseShutdownGate!: () => void;
  let markShutdownGateStarted!: () => void;
  const shutdownGateStarted = new Promise<void>((resolve) => {
    markShutdownGateStarted = resolve;
  });
  const shutdownGate = new Promise<void>((resolve) => {
    releaseShutdownGate = resolve;
  });

  const shutdownGateGuard: CanActivate = {
    async canActivate(): Promise<boolean> {
      markShutdownGateStarted();
      await shutdownGate;
      return true;
    },
  };

  @Injectable()
  class ExistingCookieGuard implements CanActivate {
    @Inject(HttpAdapterHost)
    private readonly adapterHost!: HttpAdapterHost;

    canActivate(context: ExecutionContext): boolean {
      this.adapterHost.httpAdapter.setHeader(
        context.switchToHttp().getResponse<unknown>(),
        "Set-Cookie",
        "application_cookie=preserved; HttpOnly; Path=/",
      );
      return true;
    }
  }

  @Controller()
  class ProtectedController {
    @Inject(NestOidcService)
    private readonly oidc!: NestOidcService;

    @Get("/optional")
    @UseGuards(NestOidcOptionalAuthGuard)
    @Bind(OptionalOidcAuth())
    optional(auth: AuthSessionView | null) {
      return { auth };
    }

    @Get("/optional-existing-cookie")
    @UseGuards(ExistingCookieGuard, NestOidcOptionalAuthGuard)
    @Bind(OptionalOidcAuth())
    optionalWithExistingCookie(auth: AuthSessionView | null) {
      return { auth };
    }

    @Get("/required")
    @UseGuards(NestOidcRequiredAuthGuard)
    @Bind(OidcAuth())
    required(auth: AuthSessionView) {
      return { auth };
    }

    @Get("/resolved-once")
    @UseGuards(NestOidcOptionalAuthGuard, NestOidcRequiredAuthGuard)
    @Bind(OidcAuth())
    resolvedOnce(auth: AuthSessionView) {
      return { subject: auth.user.subject };
    }

    @Get("/service-auth")
    @UseGuards(NestOidcRequiredAuthGuard)
    @Bind(Req())
    serviceAuth(request: unknown) {
      return { subject: this.oidc.getAuth(request).user.subject };
    }

    @Get("/shutdown-drain")
    @UseGuards(shutdownGateGuard, NestOidcRequiredAuthGuard)
    @Bind(OidcAuth())
    shutdownDrain(auth: AuthSessionView) {
      return { subject: auth.user.subject };
    }

    @Get("/unguarded")
    @Bind(OidcAuth())
    unguarded(auth: AuthSessionView) {
      return { subject: auth.user.subject };
    }
  }

  @Module({
    controllers: [ProtectedController],
    imports: [
      asyncRegistration
        ? NestOidcModule.registerAsync({ useFactory: async () => options })
        : NestOidcModule.register(options),
    ],
    providers: [ExistingCookieGuard],
  })
  class TestModule {}

  const app =
    platform === "fastify"
      ? await NestFactory.create(TestModule, new FastifyAdapter(), { logger: false })
      : await NestFactory.create(TestModule, { logger: false });
  applications.add(app);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    client,
    shutdownGate: {
      started: shutdownGateStarted,
      release: releaseShutdownGate,
    },
  };
};

const closeApp = async (app: INestApplication): Promise<void> => {
  await app.close();
  applications.delete(app);
};

const getSetCookies = (response: globalThis.Response): string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""].filter(Boolean);
};

afterEach(async () => {
  await Promise.all([...applications].map((app) => closeApp(app)));
});

describe.each<TestPlatform>(["express", "fastify"])("Nest %s conformance", (platform) => {
  it("starts login through the fixed route and writes a secure transaction cookie", async () => {
    const fixture = await createFixture(platform);
    const response = await fetch(`${fixture.baseUrl}/oidc/login?returnTo=%2Fdashboard`, {
      redirect: "manual",
    });

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("https://id.example.com/authorize");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(getSetCookies(response)).toEqual([
      expect.stringContaining(`${TRANSACTION_COOKIE_NAME}=`),
    ]);
    expect(getSetCookies(response)[0]).toContain("Path=/;");
    expect(fixture.client.beginLogin).toHaveBeenCalledWith({
      redirectUri: "https://app.example.com/oidc/callback",
      returnTo: "/dashboard",
    });
  });

  it("completes callback without trusting Host and clears transaction state on failure", async () => {
    const fixture = await createFixture(platform);
    const cookieName = TRANSACTION_COOKIE_NAME;
    const response = await fetch(
      `${fixture.baseUrl}/oidc/callback?code=authorization-code&state=server-state`,
      {
        headers: { Cookie: `${cookieName}=${TRANSACTION_ID}`, Host: "evil.example.com" },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(getSetCookies(response)).toEqual([
      expect.stringContaining(`${TRANSACTION_COOKIE_NAME}=;`),
      expect.stringContaining(`${SESSION_COOKIE_NAME}=`),
    ]);
    expect(fixture.client.completeCallback).toHaveBeenCalledWith({
      callbackParameters: "code=authorization-code&state=server-state",
      transactionId: TRANSACTION_ID,
    });

    fixture.client.completeCallback.mockRejectedValueOnce(
      Object.assign(new NodeOidcError("INVALID_CALLBACK"), {
        accidentalMetadata: "secret callback detail",
      }),
    );
    const failed = await fetch(`${fixture.baseUrl}/oidc/callback?code=bad&state=bad`, {
      headers: { Cookie: `${cookieName}=${TRANSACTION_ID}` },
      redirect: "manual",
    });
    expect(failed.status).toBe(400);
    expect(getSetCookies(failed)).toEqual([
      expect.stringContaining(`${TRANSACTION_COOKIE_NAME}=;`),
    ]);
    expect(JSON.stringify(await failed.json())).not.toContain("secret callback detail");
  });

  it("provides optional and required guards plus safe auth decorators", async () => {
    const fixture = await createFixture(platform);
    const anonymous = await fetch(`${fixture.baseUrl}/optional`);
    const required = await fetch(`${fixture.baseUrl}/required`);

    expect(await anonymous.json()).toEqual({ auth: null });
    expect(required.status).toBe(401);
    expect(await required.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });

    fixture.client.getSession.mockResolvedValue({
      ...session,
      accessToken: "must-not-leak",
      user: { ...session.user, internalId: "must-not-leak" },
    } as AuthSessionView);
    const authenticated = await fetch(`${fixture.baseUrl}/required`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    });
    const body = await authenticated.json();
    expect(authenticated.status).toBe(200);
    expect(body.auth.user.subject).toBe("user-1");
    expect(JSON.stringify(body)).not.toMatch(/token|sessionId|internalId/iu);
  });

  it("fails closed when auth decorators run without a guard", async () => {
    const fixture = await createFixture(platform);
    const response = await fetch(`${fixture.baseUrl}/unguarded`, {
      headers: { auth: "forged-auth-session" },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    expect(fixture.client.getSession).not.toHaveBeenCalled();
  });

  it("clears malformed session cookies and maps known storage failures", async () => {
    const fixture = await createFixture(platform);
    const malformed = await fetch(`${fixture.baseUrl}/optional`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=short` },
    });

    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toEqual({ auth: null });
    expect(getSetCookies(malformed)).toEqual([expect.stringContaining(`${SESSION_COOKIE_NAME}=;`)]);

    fixture.client.getSession.mockRejectedValueOnce(new NodeOidcError("STORAGE_FAILED"));
    const failed = await fetch(`${fixture.baseUrl}/required`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      error: { code: "STORAGE_FAILED", retryable: true },
    });
  });

  it("preserves cookies written before the optional auth guard", async () => {
    const fixture = await createFixture(platform);
    const response = await fetch(`${fixture.baseUrl}/optional-existing-cookie`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=short` },
    });

    expect(response.status).toBe(200);
    expect(getSetCookies(response)).toEqual([
      "application_cookie=preserved; HttpOnly; Path=/",
      expect.stringContaining(`${SESSION_COOKIE_NAME}=;`),
    ]);
  });

  it("shares one auth resolution between composed guards and injected service", async () => {
    const fixture = await createFixture(platform);
    const cookie = `${SESSION_COOKIE_NAME}=${SESSION_ID}`;
    const composed = await fetch(`${fixture.baseUrl}/resolved-once`, {
      headers: { Cookie: cookie },
    });
    const service = await fetch(`${fixture.baseUrl}/service-auth`, {
      headers: { Cookie: cookie },
    });

    expect(await composed.json()).toEqual({ subject: "user-1" });
    expect(await service.json()).toEqual({ subject: "user-1" });
    expect(fixture.client.getSession).toHaveBeenCalledTimes(2);
  });

  it("validates logout Origin before clearing local state", async () => {
    const fixture = await createFixture(platform);
    const cookie = `${SESSION_COOKIE_NAME}=${SESSION_ID}`;
    const rejected = await fetch(`${fixture.baseUrl}/oidc/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://evil.example.com" },
      redirect: "manual",
    });

    expect(rejected.status).toBe(403);
    expect(getSetCookies(rejected)).toEqual([]);
    expect(fixture.client.logout).not.toHaveBeenCalled();

    fixture.client.logout.mockRejectedValueOnce(new NodeOidcError("LOGOUT_FAILED"));
    const failed = await fetch(`${fixture.baseUrl}/oidc/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://app.example.com" },
      redirect: "manual",
    });
    expect(failed.status).toBe(502);
    expect(getSetCookies(failed)).toEqual([expect.stringContaining(`${SESSION_COOKIE_NAME}=;`)]);

    const accepted = await fetch(`${fixture.baseUrl}/oidc/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: "https://app.example.com" },
      redirect: "manual",
    });
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get("location")).toBe("https://id.example.com/session/end");
    expect(getSetCookies(accepted)).toEqual([expect.stringContaining(`${SESSION_COOKIE_NAME}=;`)]);
    expect(fixture.client.logout).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      postLogoutRedirectUri: "https://app.example.com/signed-out",
    });
  });

  it("returns 405 for wrong methods including HEAD", async () => {
    const fixture = await createFixture(platform);
    const [login, callback, logout] = await Promise.all([
      fetch(`${fixture.baseUrl}/oidc/login`, { method: "POST" }),
      fetch(`${fixture.baseUrl}/oidc/callback`, { method: "HEAD" }),
      fetch(`${fixture.baseUrl}/oidc/logout`),
    ]);

    expect(login.status).toBe(405);
    expect(login.headers.get("allow")).toBe("GET");
    expect(callback.status).toBe(405);
    expect(callback.headers.get("allow")).toBe("GET");
    expect(logout.status).toBe(405);
    expect(logout.headers.get("allow")).toBe("POST");
  });

  it("does not close an injected Node client during module shutdown", async () => {
    const fixture = await createFixture(platform);

    await closeApp(fixture.app);

    expect(fixture.client.close).not.toHaveBeenCalled();
  });

  it("closes the connector only after the HTTP adapter", async () => {
    const fixture = await createFixture(platform);
    const adapterClose = vi.spyOn(fixture.app.getHttpAdapter(), "close");
    const service = fixture.app.get(NestOidcService);
    const connectorClose = vi.spyOn(service, "close");

    await closeApp(fixture.app);

    expect(adapterClose).toHaveBeenCalledOnce();
    expect(connectorClose).toHaveBeenCalledOnce();
    expect(adapterClose.mock.invocationCallOrder[0]).toBeLessThan(
      connectorClose.mock.invocationCallOrder[0]!,
    );
  });

  it("drains an accepted request before closing the connector", async () => {
    const fixture = await createFixture(platform);
    const service = fixture.app.get(NestOidcService);
    const close = vi.spyOn(service, "close");
    const response = fetch(`${fixture.baseUrl}/shutdown-drain`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    });
    await fixture.shutdownGate.started;

    const closing = fixture.app.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(close).not.toHaveBeenCalled();
    expect(fixture.client.getSession).not.toHaveBeenCalled();

    fixture.shutdownGate.release();
    await expect(
      response.then(async (value) => ({ status: value.status, body: await value.json() })),
    ).resolves.toEqual({ status: 200, body: { subject: "user-1" } });
    await closing;
    applications.delete(fixture.app);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("Nest Fastify shutdown", () => {
  it("delivers callback Session Cookie before closing the socket", async () => {
    const fixture = await createFixture("fastify");
    const service = fixture.app.get(NestOidcService);
    const connectorClose = vi.spyOn(service, "close");
    let markCallbackStarted!: () => void;
    let releaseCallback!: () => void;
    const callbackStarted = new Promise<void>((resolve) => {
      markCallbackStarted = resolve;
    });
    const callbackGate = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    fixture.client.completeCallback.mockImplementationOnce(async () => {
      markCallbackStarted();
      await callbackGate;
      return { sessionId: SESSION_ID, session, returnTo: "/dashboard" };
    });
    const responsePromise = fetch(
      `${fixture.baseUrl}/oidc/callback?code=authorization-code&state=server-state`,
      {
        headers: { Cookie: `${TRANSACTION_COOKIE_NAME}=${TRANSACTION_ID}` },
        redirect: "manual",
      },
    );
    await callbackStarted;

    let closeResolved = false;
    const closing = fixture.app.close().then(() => {
      closeResolved = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResolved).toBe(false);
      expect(connectorClose).not.toHaveBeenCalled();

      releaseCallback();
      const response = await responsePromise;
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/dashboard");
      expect(getSetCookies(response)).toEqual([
        expect.stringContaining(`${TRANSACTION_COOKIE_NAME}=;`),
        expect.stringContaining(`${SESSION_COOKIE_NAME}=${SESSION_ID}`),
      ]);
      await closing;
      expect(closeResolved).toBe(true);
      expect(connectorClose).toHaveBeenCalledOnce();
    } finally {
      releaseCallback();
      await Promise.allSettled([closing, responsePromise]);
      applications.delete(fixture.app);
    }
  });

  it("lets an accepted guarded request finish during explicit service close", async () => {
    const fixture = await createFixture("fastify");
    const service = fixture.app.get(NestOidcService);
    const responsePromise = fetch(`${fixture.baseUrl}/shutdown-drain`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${SESSION_ID}` },
    });
    await fixture.shutdownGate.started;

    let closeResolved = false;
    const closing = service.close().then(() => {
      closeResolved = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(closeResolved).toBe(false);

      fixture.shutdownGate.release();
      await expect(
        responsePromise.then(async (response) => ({
          body: await response.json(),
          status: response.status,
        })),
      ).resolves.toEqual({ body: { subject: "user-1" }, status: 200 });
      await closing;
      expect(closeResolved).toBe(true);
    } finally {
      fixture.shutdownGate.release();
      await Promise.allSettled([closing, responsePromise]);
    }
  });
});

describe("NestOidcModule.registerAsync", () => {
  it("resolves options from an async factory", async () => {
    const fixture = await createFixture("express", true);
    const response = await fetch(`${fixture.baseUrl}/oidc/login`, { redirect: "manual" });

    expect(response.status).toBe(303);
    expect(fixture.client.beginLogin).toHaveBeenCalledOnce();
  });
});
