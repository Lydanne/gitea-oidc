import { once } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { createNodeDependencies } from "../nodeDependencies.js";

describe("node HTTP client", () => {
  it("connects only through the explicitly pinned addresses", async () => {
    let receivedHost: string | undefined;
    const server = createServer((request, response) => {
      receivedHost = request.headers.host;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("pinned response");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("测试服务器未监听 TCP 端口");
      }

      const response = await createNodeDependencies().httpClient.fetch(
        `http://dns-rebinding.invalid:${address.port}/discovery`,
        {
          headers: { accept: "text/plain" },
          pinnedAddresses: ["127.0.0.1"],
          redirect: "manual",
          signal: new AbortController().signal,
        },
      );

      expect(response.status).toBe(200);
      expect(await response.readText(1024)).toBe("pinned response");
      expect(receivedHost).toBe(`dns-rebinding.invalid:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
