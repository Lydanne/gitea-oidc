import fastify from "fastify";
import { describe, expect, it } from "vitest";
import { getRawRequestBody, registerRawJsonBodyParser } from "../rawBody";

describe("raw body parser", () => {
  it("preserves the original JSON body while still parsing request.body", async () => {
    const app = fastify();
    registerRawJsonBodyParser(app);
    app.post("/echo", async (request) => ({
      parsed: request.body,
      rawBody: getRawRequestBody(request),
    }));

    const rawBody = '{ "b": 2, "a": 1 }';
    const response = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      parsed: { b: 2, a: 1 },
      rawBody,
    });
  });
});
