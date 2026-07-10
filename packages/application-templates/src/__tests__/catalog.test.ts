import { describe, expect, it } from "vitest";
import {
  applicationTemplateCatalog,
  createTemplateCatalog,
  GiteaTemplateV1,
  TemplateCatalogError,
} from "../index.js";

describe("TemplateCatalog", () => {
  it("lists immutable versioned template metadata", () => {
    const templates = applicationTemplateCatalog.list();

    expect(templates).toEqual([
      {
        reference: { id: "gitea", version: 1 },
        name: "Gitea",
        description: expect.any(String),
        supportedVersions: ["1.24", "1.25", "1.26"],
        form: expect.objectContaining({ fields: expect.any(Array) }),
      },
    ]);
    expect(Object.isFrozen(templates)).toBe(true);
    expect(Object.isFrozen(templates[0]?.supportedVersions)).toBe(true);
    expect(Object.isFrozen(templates[0]?.form)).toBe(true);
  });

  it("requires an exact version for persisted references and exposes latest explicitly", () => {
    expect(applicationTemplateCatalog.get({ id: "gitea", version: 1 })).toMatchObject({
      id: GiteaTemplateV1.id,
      version: GiteaTemplateV1.version,
      preview: GiteaTemplateV1.preview,
      resolve: GiteaTemplateV1.resolve,
    });
    expect(applicationTemplateCatalog.getLatest("gitea")).toMatchObject({
      id: GiteaTemplateV1.id,
      version: GiteaTemplateV1.version,
    });
    expect(() => applicationTemplateCatalog.get({ id: "gitea", version: 2 })).toThrowError(
      TemplateCatalogError,
    );
  });

  it("rejects duplicate template versions during catalog construction", () => {
    expect(() => createTemplateCatalog([GiteaTemplateV1, GiteaTemplateV1])).toThrowError(
      expect.objectContaining({ code: "DUPLICATE_TEMPLATE" }),
    );
  });

  it("rejects malformed template declarations", () => {
    expect(() =>
      createTemplateCatalog([
        {
          ...GiteaTemplateV1,
          id: "unsafe/template",
        },
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TEMPLATE_DEFINITION" }));
  });

  it("delegates preview and resolve through an exact template reference", () => {
    const input = {
      giteaBaseUrl: "https://gitea.example.com",
      authSourceName: "company-sso",
      targetVersion: "1.25",
      environment: "production",
    };
    const context = { issuer: "https://id.example.com" };

    const preview = applicationTemplateCatalog.preview({ id: "gitea", version: 1 }, input, context);
    const resolution = applicationTemplateCatalog.resolve(
      { id: "gitea", version: 1 },
      input,
      context,
    );

    expect(preview).not.toHaveProperty("snapshot");
    expect(resolution.snapshot.template).toEqual({ id: "gitea", version: 1 });
    expect(resolution.resolution.client.redirectUris).toEqual([
      "https://gitea.example.com/user/oauth2/company-sso/callback",
    ]);
  });

  it("rejects a resolver that returns a different template reference", () => {
    const catalog = createTemplateCatalog([
      {
        ...GiteaTemplateV1,
        id: "spoofed-template",
      },
    ]);
    const input = {
      giteaBaseUrl: "https://gitea.example.com",
      authSourceName: "company-sso",
      targetVersion: "1.26",
      environment: "production",
    };

    expect(() =>
      catalog.resolve({ id: "spoofed-template", version: 1 }, input, {
        issuer: "https://id.example.com",
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_TEMPLATE_DEFINITION" }));
  });
});
