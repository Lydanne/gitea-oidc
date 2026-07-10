import { NodeOidcError } from "@gitea-oidc/node";
import { describe, expect, it } from "vitest";
import { connectorError, mapConnectorError } from "../index.js";

describe("connector error mapping", () => {
  it("maps connector errors to a stable public body", () => {
    expect(mapConnectorError(connectorError("AUTH_REQUIRED"))).toEqual({
      status: 401,
      body: {
        error: {
          code: "AUTH_REQUIRED",
          message: "需要有效的认证会话",
          retryable: false,
        },
      },
    });
  });

  it("uses fixed redacted text for symbol-branded Node errors", () => {
    const error = Object.assign(new NodeOidcError("STORAGE_FAILED"), {
      accidentalMetadata: "token=must-not-leak",
    });

    expect(mapConnectorError(error)).toEqual({
      status: 503,
      body: {
        error: {
          code: "STORAGE_FAILED",
          message: "认证服务暂时不可用",
          retryable: true,
        },
      },
    });
    expect(JSON.stringify(mapConnectorError(error))).not.toContain("must-not-leak");
  });

  it("leaves unknown failures to the framework error chain", () => {
    expect(mapConnectorError(new Error("unknown"))).toBeNull();
  });
});
