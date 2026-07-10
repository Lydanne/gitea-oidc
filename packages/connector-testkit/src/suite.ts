import { createHash } from "node:crypto";
import { OIDC_CALLBACK_PATH, OIDC_LOGIN_PATH, OIDC_LOGOUT_PATH } from "@gitea-oidc/connector-core";
import { type AuthSessionView, NodeOidcError } from "@gitea-oidc/node";
import { afterEach, describe, expect, it } from "vitest";
import {
  CONFORMANCE_CONFIGURATION,
  CONFORMANCE_SESSION,
  CONFORMANCE_SESSION_ID,
  CONFORMANCE_TRANSACTION_ID,
  createConformanceClient,
  createOwnedConformanceClientOptions,
} from "./client.js";
import type {
  ConnectorConformanceFixture,
  ConnectorConformanceHarness,
  OwnedConnectorConformanceFixture,
} from "./types.js";

const cookieNamespace = createHash("sha256")
  .update(new URL(CONFORMANCE_CONFIGURATION.redirectUri).origin)
  .digest("base64url")
  .slice(0, 16);
const transactionCookieName = `__Host-gitea_oidc_transaction_${cookieNamespace}`;
const sessionCookieName = `__Host-gitea_oidc_session_${cookieNamespace}`;
const transactionCookie = () => `${transactionCookieName}=${CONFORMANCE_TRANSACTION_ID}`;
const sessionCookie = () => `${sessionCookieName}=${CONFORMANCE_SESSION_ID}`;

const expectErrorCode = (body: unknown, code: string): void => {
  expect(body).toMatchObject({ error: { code } });
};

export const defineConnectorConformanceSuite = (harness: ConnectorConformanceHarness): void => {
  describe(`${harness.name} connector conformance`, () => {
    const fixtures = new Set<ConnectorConformanceFixture>();

    const track = <T extends ConnectorConformanceFixture>(fixture: T): T => {
      fixtures.add(fixture);
      return fixture;
    };

    const close = async (fixture: ConnectorConformanceFixture): Promise<void> => {
      if (!fixtures.delete(fixture)) {
        return;
      }
      await fixture.close();
    };

    afterEach(async () => {
      await Promise.all([...fixtures].map(close));
    });

    it("starts login with a safe returnTo and rejects external return targets", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const returnTo = "/dashboard?tab=security";
      const response = await fixture.request({
        method: "GET",
        url: `${OIDC_LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`,
      });

      expect(response.statusCode).toBe(303);
      expect(response.header("location")).toContain("https://id.example.com/authorize");
      expect(response.header("cache-control")).toBe("no-store");
      expect(response.header("referrer-policy")).toBe("no-referrer");
      expect(response.setCookies).toEqual([expect.stringContaining(`${transactionCookieName}=`)]);
      expect(response.setCookies[0]).toContain("Path=/;");
      expect(controller.calls.beginLogin).toEqual([
        { redirectUri: CONFORMANCE_CONFIGURATION.redirectUri, returnTo },
      ]);

      for (const unsafeReturnTo of [
        "https://evil.example.com",
        "/..//evil.example.com",
        "/%2f%2fevil.example.com",
      ]) {
        const rejected = await fixture.request({
          method: "GET",
          url: `${OIDC_LOGIN_PATH}?returnTo=${encodeURIComponent(unsafeReturnTo)}`,
        });
        expect(rejected.statusCode).toBe(400);
        expectErrorCode(rejected.json(), "INVALID_REQUEST");
      }
      expect(controller.calls.beginLogin).toHaveLength(1);
    });

    it("uses the fixed callback and clears transaction state on success and error", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const response = await fixture.request({
        method: "GET",
        url: `${OIDC_CALLBACK_PATH}?code=authorization-code&state=server-state`,
        headers: { cookie: transactionCookie(), host: "evil.example.com" },
      });

      expect(response.statusCode).toBe(303);
      expect(response.header("location")).toBe("/dashboard");
      expect(response.setCookies).toEqual([
        expect.stringContaining(`${transactionCookieName}=;`),
        expect.stringContaining(`${sessionCookieName}=`),
      ]);
      expect(controller.calls.completeCallback).toEqual([
        {
          callbackParameters: "code=authorization-code&state=server-state",
          transactionId: CONFORMANCE_TRANSACTION_ID,
        },
      ]);

      controller.failNextCallback(
        Object.assign(new NodeOidcError("INVALID_CALLBACK"), {
          accidentalMetadata: "must-not-leak",
        }),
      );
      const failed = await fixture.request({
        method: "GET",
        url: `${OIDC_CALLBACK_PATH}?code=bad&state=bad`,
        headers: { cookie: transactionCookie() },
      });
      expect(failed.statusCode).toBe(400);
      expect(failed.setCookies).toEqual([expect.stringContaining(`${transactionCookieName}=;`)]);
      expectErrorCode(failed.json(), "INVALID_CALLBACK");
      expect(failed.body).not.toContain("must-not-leak");
    });

    it("projects public auth and enforces optional and required authentication", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const anonymous = await fixture.request({ method: "GET", url: "/optional" });
      const required = await fixture.request({ method: "GET", url: "/required" });

      expect(anonymous.json()).toEqual({ auth: null });
      expect(required.statusCode).toBe(401);
      expectErrorCode(required.json(), "AUTH_REQUIRED");

      controller.setSessionResponse({
        ...CONFORMANCE_SESSION,
        accessToken: "must-not-leak",
        sessionId: "must-not-leak",
        user: { ...CONFORMANCE_SESSION.user, internalId: "must-not-leak" },
      });
      const authenticated = await fixture.request({
        method: "GET",
        url: "/required",
        headers: { cookie: sessionCookie() },
      });
      expect(authenticated.statusCode).toBe(200);
      expect(authenticated.json<{ auth: AuthSessionView }>().auth.user.subject).toBe("user-1");
      expect(authenticated.body).not.toMatch(/token|sessionId|internalId|must-not-leak/iu);

      const duplicateCookie = await fixture.request({
        method: "GET",
        url: "/optional",
        headers: { cookie: `${sessionCookie()}; ${sessionCookie()}` },
      });
      expect(duplicateCookie.json()).toEqual({ auth: null });
      expect(duplicateCookie.setCookies).toEqual([
        expect.stringContaining(`${sessionCookieName}=;`),
      ]);
    });

    it("shares one auth resolution between optional and required hooks", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const response = await fixture.request({
        method: "GET",
        url: "/resolved-once",
        headers: { cookie: sessionCookie() },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ subject: "user-1" });
      expect(controller.calls.getSession).toEqual([CONFORMANCE_SESSION_ID]);
    });

    it("requires POST and same-origin Origin before mutating logout state", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const rejected = await fixture.request({
        method: "POST",
        url: OIDC_LOGOUT_PATH,
        headers: { cookie: sessionCookie(), origin: "https://evil.example.com" },
      });

      expect(rejected.statusCode).toBe(403);
      expect(rejected.setCookies).toEqual([]);
      expectErrorCode(rejected.json(), "CSRF_REJECTED");
      expect(controller.calls.logout).toHaveLength(0);

      const accepted = await fixture.request({
        method: "POST",
        url: OIDC_LOGOUT_PATH,
        headers: {
          cookie: sessionCookie(),
          origin: new URL(CONFORMANCE_CONFIGURATION.redirectUri).origin,
        },
      });
      expect(accepted.statusCode).toBe(303);
      expect(accepted.header("location")).toBe("https://id.example.com/session/end");
      expect(accepted.setCookies).toEqual([expect.stringContaining(`${sessionCookieName}=;`)]);
      expect(controller.calls.logout).toEqual([
        {
          sessionId: CONFORMANCE_SESSION_ID,
          postLogoutRedirectUri: CONFORMANCE_CONFIGURATION.postLogoutRedirectUri,
        },
      ]);

      controller.failNextLogout(new NodeOidcError("LOGOUT_FAILED"));
      const failed = await fixture.request({
        method: "POST",
        url: OIDC_LOGOUT_PATH,
        headers: {
          cookie: sessionCookie(),
          origin: new URL(CONFORMANCE_CONFIGURATION.redirectUri).origin,
        },
      });
      expect(failed.statusCode).toBe(502);
      expect(failed.setCookies).toEqual([expect.stringContaining(`${sessionCookieName}=;`)]);
      expectErrorCode(failed.json(), "LOGOUT_FAILED");
      expect(controller.calls.logout).toHaveLength(2);
    });

    it("returns 405 with an exact Allow header for wrong methods", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );
      const [login, callback, logout, traceLogin, traceCallback, traceLogout] = await Promise.all([
        fixture.request({ method: "POST", url: OIDC_LOGIN_PATH }),
        fixture.request({ method: "HEAD", url: OIDC_CALLBACK_PATH }),
        fixture.request({ method: "GET", url: OIDC_LOGOUT_PATH }),
        fixture.request({ method: "TRACE", url: OIDC_LOGIN_PATH }),
        fixture.request({ method: "TRACE", url: OIDC_CALLBACK_PATH }),
        fixture.request({ method: "TRACE", url: OIDC_LOGOUT_PATH }),
      ]);

      expect(login.statusCode).toBe(405);
      expect(login.header("allow")).toBe("GET");
      expect(callback.statusCode).toBe(405);
      expect(callback.header("allow")).toBe("GET");
      expect(logout.statusCode).toBe(405);
      expect(logout.header("allow")).toBe("POST");
      expect(traceLogin.statusCode).toBe(405);
      expect(traceLogin.header("allow")).toBe("GET");
      expect(traceCallback.statusCode).toBe(405);
      expect(traceCallback.header("allow")).toBe("GET");
      expect(traceLogout.statusCode).toBe(405);
      expect(traceLogout.header("allow")).toBe("POST");
    });

    it("does not close an injected client", async () => {
      const controller = createConformanceClient();
      const fixture = track(
        await harness.createInjected({
          client: controller.client,
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );

      await close(fixture);

      expect(controller.calls.close).toBe(0);
    });

    it("closes an owned client through the framework lifecycle", async () => {
      const fixture: OwnedConnectorConformanceFixture = track(
        await harness.createOwned({
          clientOptions: createOwnedConformanceClientOptions(),
          configuration: CONFORMANCE_CONFIGURATION,
        }),
      );

      await fixture.close();
      const probe = await fixture.probeAfterClose();
      fixtures.delete(fixture);

      expect(probe.statusCode).toBe(503);
      expectErrorCode(probe.json(), "CLIENT_CLOSED");
    });
  });
};
