import type { FastifyInstance, FastifyRequest } from "fastify";

type RequestWithRawBody = FastifyRequest & {
  rawBody?: unknown;
};

/**
 * 注册 JSON body parser，并在 request 上保留原始 body 文本。
 */
export function registerRawJsonBodyParser(app: FastifyInstance): void {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, rawBody, done) => {
    const rawText = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
    (request as RequestWithRawBody).rawBody = rawText;

    if (rawText.length === 0) {
      done(null, null);
      return;
    }

    try {
      done(null, JSON.parse(rawText));
    } catch (err) {
      done(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 获取 JSON parser 捕获的原始 body 文本。
 */
export function getRawRequestBody(request: FastifyRequest): string | undefined {
  const rawBody = (request as RequestWithRawBody).rawBody;
  return typeof rawBody === "string" ? rawBody : undefined;
}
