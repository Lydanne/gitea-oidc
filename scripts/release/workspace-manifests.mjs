export const RELEASE_MANIFEST_PATH = "packages/server-core/package.json";

export const WORKSPACE_MANIFEST_PATHS = Object.freeze([
  "package.json",
  "apps/admin-web/package.json",
  "apps/idp-server/package.json",
  "apps/portal-web/package.json",
  "packages/application-templates/package.json",
  "packages/applications/package.json",
  "packages/cli/package.json",
  "packages/connector-core/package.json",
  "packages/connector-testkit/package.json",
  "packages/contracts/package.json",
  "packages/express/package.json",
  "packages/fastify/package.json",
  "packages/nestjs/package.json",
  "packages/oidc-client/package.json",
  "packages/oidc-client-sqlite/package.json",
  RELEASE_MANIFEST_PATH,
]);
