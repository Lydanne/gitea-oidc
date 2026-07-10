import { rm } from "node:fs/promises";

const outputs = [
  new URL("../dist", import.meta.url),
  new URL("../apps/admin-web/dist", import.meta.url),
  new URL("../apps/idp-server/dist", import.meta.url),
  new URL("../packages/server-core/.cache", import.meta.url),
  new URL("../packages/server-core/dist", import.meta.url),
  new URL("../packages/contracts/.cache", import.meta.url),
  new URL("../packages/contracts/dist", import.meta.url),
  new URL("../packages/applications/dist", import.meta.url),
];

await Promise.all(outputs.map((output) => rm(output, { force: true, recursive: true })));
