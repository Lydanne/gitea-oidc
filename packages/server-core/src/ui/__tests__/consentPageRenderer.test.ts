import { describe, expect, it } from "vitest";
import { readConsentGrantDisclosure, renderConsentPage } from "../consentPageRenderer.js";

describe("renderConsentPage", () => {
  it("转义应用、Client 和全部授权内容，并固定表单动作", () => {
    const disclosure = readConsentGrantDisclosure({
      missingOIDCScope: ["openid", "openid", 42],
      missingOIDCClaims: ["email", '<img src=x onerror="claim()">'],
      missingResourceScopes: {
        'https://api.example.com/"><script>resource()</script>': [
          "read:profile",
          '<script>alert("resource-scope")</script>',
        ],
        "https://empty.example.com": [],
      },
    });
    expect(disclosure).toEqual({
      oidcScopes: ["openid"],
      oidcClaims: ["email", '<img src=x onerror="claim()">'],
      resourceScopes: [
        {
          indicator: 'https://api.example.com/"><script>resource()</script>',
          scopes: ["read:profile", '<script>alert("resource-scope")</script>'],
        },
      ],
    });

    const html = renderConsentPage({
      uid: 'uid"/../x',
      applicationName: '<img src=x onerror="alert(1)">',
      clientId: 'client"><script>alert(1)</script>',
      scopes: ["openid", '<script>alert("scope")</script>'],
      claims: disclosure.oidcClaims,
      resources: disclosure.resourceScopes,
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
    expect(html).toContain("还会授予以下 Claim");
    expect(html).toContain("还会授予以下 Resource Scope");
    expect(html).toContain("email");
    expect(html).toContain("https://api.example.com/");
    expect(html).toContain("read:profile");
    expect(html).toContain('action="/interaction/uid%22%2F..%2Fx/consent"');
    expect(html).toContain('name="decision" value="approve"');
    expect(html).not.toMatch(/name="client|name="scope/);
  });
});
