import { rm } from "node:fs/promises";

await Promise.all(
  [new URL("../dist", import.meta.url), new URL("../.cache", import.meta.url)].map((output) =>
    rm(output, { force: true, recursive: true }),
  ),
);
