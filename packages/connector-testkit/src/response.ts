import type { ConnectorConformanceResponse } from "./types.js";

export interface CreateConnectorConformanceResponseInput {
  readonly statusCode: number;
  readonly body: string;
  readonly headers?: Iterable<readonly [string, string]>;
  readonly setCookies?: readonly string[];
}

export const createConnectorConformanceResponse = (
  input: CreateConnectorConformanceResponseInput,
): ConnectorConformanceResponse => {
  const headers = new Map<string, string>();
  for (const [name, value] of input.headers ?? []) {
    headers.set(name.toLowerCase(), value);
  }
  const setCookies = Object.freeze([...(input.setCookies ?? [])]);
  return Object.freeze({
    statusCode: input.statusCode,
    body: input.body,
    setCookies,
    header(name: string) {
      return headers.get(name.toLowerCase()) ?? null;
    },
    json<T = unknown>() {
      return JSON.parse(input.body) as T;
    },
  });
};
