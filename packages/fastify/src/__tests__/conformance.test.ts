import {
  type ConnectorConformanceConfiguration,
  type ConnectorConformanceHarness,
  type ConnectorConformanceRequest,
  type ConnectorConformanceResponse,
  createConnectorConformanceResponse,
  defineConnectorConformanceSuite,
} from "@x-oidc/connector-testkit";
import type { NodeOidcClient, NodeOidcClientOptions } from "@x-oidc/node";
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type LightMyRequestResponse,
} from "fastify";
import { createFastifyOidc, type FastifyOidcPlugin } from "../index.js";

const getSetCookies = (response: LightMyRequestResponse): string[] => {
  const value = response.headers["set-cookie"];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

const normalizeInjectResponse = (response: LightMyRequestResponse): ConnectorConformanceResponse =>
  createConnectorConformanceResponse({
    statusCode: response.statusCode,
    body: response.body,
    headers: Object.entries(response.headers).flatMap(([name, value]) =>
      value === undefined
        ? []
        : (Array.isArray(value) ? value : [value]).map((item) => [name, String(item)] as const),
    ),
    setCookies: getSetCookies(response),
  });

const probeAfterClose = async (
  app: ReturnType<typeof Fastify>,
  oidc: FastifyOidcPlugin,
): Promise<ConnectorConformanceResponse> => {
  const headers = new Map<string, string[]>();
  let statusCode = 200;
  let body: unknown;
  const reply = {
    sent: false,
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    header(name: string, value: string | number | readonly string[]) {
      const key = name.toLowerCase();
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      headers.set(key, key === "set-cookie" ? [...(headers.get(key) ?? []), ...values] : values);
      return this;
    },
    code(value: number) {
      statusCode = value;
      return this;
    },
    send(value: unknown) {
      body = value;
      this.sent = true;
      return this;
    },
  } as unknown as FastifyReply;
  const request = {
    headers: { cookie: `__Host-x_oidc_session=${"s".repeat(43)}` },
  } as FastifyRequest;

  await oidc.optionalAuth.call(app, request, reply);
  return createConnectorConformanceResponse({
    statusCode,
    body: JSON.stringify(body),
    headers: [...headers].flatMap(([name, values]) =>
      values.map((value) => [name, value] as const),
    ),
    setCookies: headers.get("set-cookie") ?? [],
  });
};

const createFixture = async (
  source: { client: NodeOidcClient } | { clientOptions: NodeOidcClientOptions },
  configuration: ConnectorConformanceConfiguration,
) => {
  const app = Fastify();
  const oidc = createFastifyOidc({ ...source, ...configuration });
  app.register(oidc);
  app.get("/optional", { preHandler: oidc.optionalAuth }, async (request) => ({
    auth: request.auth,
  }));
  app.get("/required", { preHandler: oidc.requireAuth }, async (request) => ({
    auth: oidc.getAuth(request),
  }));
  app.get(
    "/resolved-once",
    { preHandler: [oidc.optionalAuth, oidc.requireAuth] },
    async (request) => ({ subject: oidc.getAuth(request).user.subject }),
  );
  await app.ready();
  let closed = false;

  return {
    async request(input: ConnectorConformanceRequest) {
      return normalizeInjectResponse(
        await app.inject({
          method: input.method,
          url: input.url,
          headers: input.headers,
        }),
      );
    },
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
    },
    async probeAfterClose() {
      return await probeAfterClose(app, oidc);
    },
  };
};

const harness: ConnectorConformanceHarness = {
  name: "Fastify 5",
  createInjected: ({ client, configuration }) => createFixture({ client }, configuration),
  createOwned: ({ clientOptions, configuration }) =>
    createFixture({ clientOptions }, configuration),
};

defineConnectorConformanceSuite(harness);
