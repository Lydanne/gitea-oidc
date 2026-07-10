import { request as createHttpRequest, createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type ConnectorConformanceConfiguration,
  type ConnectorConformanceHarness,
  type ConnectorConformanceRequest,
  type ConnectorConformanceResponse,
  createConnectorConformanceResponse,
  defineConnectorConformanceSuite,
} from "@gitea-oidc/connector-testkit";
import type { NodeOidcClient, NodeOidcClientOptions } from "@gitea-oidc/node";
import express, { type NextFunction, type Request, type Response } from "express";
import { createExpressOidc, type ExpressOidc } from "../index.js";

const getSetCookies = (response: globalThis.Response): string[] => {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [response.headers.get("set-cookie") ?? ""].filter(Boolean);
};

const normalizeFetchResponse = async (
  response: globalThis.Response,
): Promise<ConnectorConformanceResponse> => {
  const setCookies = getSetCookies(response);
  const body = await response.text();
  return createConnectorConformanceResponse({
    statusCode: response.status,
    body,
    headers: response.headers.entries(),
    setCookies,
  });
};

const requestWithNodeHttp = async (
  baseUrl: string,
  input: ConnectorConformanceRequest,
): Promise<ConnectorConformanceResponse> =>
  await new Promise((resolve, reject) => {
    const request = createHttpRequest(
      `${baseUrl}${input.url}`,
      { method: input.method, headers: input.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers: Array<readonly [string, string]> = [];
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            headers.push([response.rawHeaders[index] ?? "", response.rawHeaders[index + 1] ?? ""]);
          }
          resolve(
            createConnectorConformanceResponse({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              headers,
              setCookies: response.headers["set-cookie"] ?? [],
            }),
          );
        });
      },
    );
    request.on("error", reject);
    request.end();
  });

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
};

const probeAfterClose = async (oidc: ExpressOidc): Promise<ConnectorConformanceResponse> =>
  await new Promise((resolve, reject) => {
    const headers = new Map<string, string[]>();
    let statusCode = 200;
    let settled = false;
    const finish = (body: unknown) => {
      if (settled) return;
      settled = true;
      resolve(
        createConnectorConformanceResponse({
          statusCode,
          body: JSON.stringify(body),
          headers: [...headers].flatMap(([name, values]) =>
            values.map((value) => [name, value] as const),
          ),
          setCookies: headers.get("set-cookie") ?? [],
        }),
      );
    };
    const response = {
      headersSent: false,
      setHeader(name: string, value: string | number | readonly string[]) {
        headers.set(name.toLowerCase(), Array.isArray(value) ? value.map(String) : [String(value)]);
        return this;
      },
      append(name: string, value: string) {
        const key = name.toLowerCase();
        headers.set(key, [...(headers.get(key) ?? []), value]);
        return this;
      },
      status(value: number) {
        statusCode = value;
        return this;
      },
      json(body: unknown) {
        this.headersSent = true;
        finish(body);
        return this;
      },
    } as unknown as Response;
    const request = {
      headers: { cookie: `__Host-gitea_oidc_session=${"s".repeat(43)}` },
    } as Request;
    const next: NextFunction = (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      finish({ open: true });
    };
    oidc.optionalAuth(request, response, next);
  });

const createFixture = async (
  source: { client: NodeOidcClient } | { clientOptions: NodeOidcClientOptions },
  configuration: ConnectorConformanceConfiguration,
) => {
  const oidc = createExpressOidc({ ...source, ...configuration });
  const app = express();
  app.use(oidc.router);
  app.get("/optional", oidc.optionalAuth, (request, response) => {
    response.json({ auth: request.auth ?? null });
  });
  app.get("/required", oidc.requireAuth, (request, response) => {
    response.json({ auth: oidc.getAuth(request) });
  });
  app.get("/resolved-once", oidc.optionalAuth, oidc.requireAuth, (request, response) => {
    response.json({ subject: oidc.getAuth(request).user.subject });
  });

  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  let closed = false;

  return {
    async request(input: ConnectorConformanceRequest) {
      if (input.method === "TRACE") {
        return await requestWithNodeHttp(baseUrl, input);
      }
      return await normalizeFetchResponse(
        await fetch(`${baseUrl}${input.url}`, {
          method: input.method,
          headers: input.headers,
          redirect: "manual",
        }),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      await oidc.close();
      await closeServer(server);
    },
    async probeAfterClose() {
      return await probeAfterClose(oidc);
    },
  };
};

const harness: ConnectorConformanceHarness = {
  name: "Express 5",
  createInjected: ({ client, configuration }) => createFixture({ client }, configuration),
  createOwned: ({ clientOptions, configuration }) =>
    createFixture({ clientOptions }, configuration),
};

defineConnectorConformanceSuite(harness);
