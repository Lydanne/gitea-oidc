import { describe, expect, it } from "vitest";
import {
  CONFORMANCE_SESSION_ID,
  createConformanceClient,
  createConnectorConformanceResponse,
  createOwnedConformanceClientOptions,
} from "../index.js";

describe("connector conformance client", () => {
  it("records public Node client calls without framework state", async () => {
    const controller = createConformanceClient();

    await controller.client.getSession(CONFORMANCE_SESSION_ID);
    await controller.client.close();

    expect(controller.calls.getSession).toEqual([CONFORMANCE_SESSION_ID]);
    expect(controller.calls.close).toBe(1);
  });

  it("creates a fully bound owned-client fixture", () => {
    const options = createOwnedConformanceClientOptions();

    expect(options.credential).toMatchObject({
      applicationId: options.connection.applicationId,
      oidcClientId: options.connection.oidcClientId,
      issuer: options.connection.issuer,
      clientId: options.connection.clientId,
    });
  });

  it("normalizes response headers without depending on a framework", () => {
    const response = createConnectorConformanceResponse({
      statusCode: 200,
      body: '{"ok":true}',
      headers: [["Content-Type", "application/json"]],
      setCookies: ["session=value"],
    });

    expect(response.header("content-type")).toBe("application/json");
    expect(response.json()).toEqual({ ok: true });
    expect(response.setCookies).toEqual(["session=value"]);
  });
});
