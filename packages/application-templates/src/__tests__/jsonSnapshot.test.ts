import { describe, expect, it } from "vitest";
import { createImmutableJsonSnapshot } from "../index.js";

describe("createImmutableJsonSnapshot", () => {
  it("clones and deeply freezes JSON values without retaining mutable references", () => {
    const source = { nested: { enabled: true }, values: [1, "two"] };
    const snapshot = createImmutableJsonSnapshot(source);

    source.nested.enabled = false;
    source.values.push(3);

    expect(snapshot).toEqual({ nested: { enabled: true }, values: [1, "two"] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.values)).toBe(true);
  });

  it.each([
    ["undefined", { value: undefined }],
    ["function", { value: () => true }],
    ["bigint", { value: 1n }],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["class instance", { value: new Date() }],
  ])("rejects %s instead of silently changing it", (_name, value) => {
    expect(() => createImmutableJsonSnapshot(value)).toThrow(TypeError);
  });

  it("rejects circular references", () => {
    const value: { self?: unknown } = {};
    value.self = value;

    expect(() => createImmutableJsonSnapshot(value)).toThrow(/循环引用/u);
  });

  it("rejects sparse arrays and hidden properties instead of changing their JSON meaning", () => {
    const sparse = new Array(1);
    const hidden = {};
    Object.defineProperty(hidden, "secret", { enumerable: false, value: "hidden" });

    expect(() => createImmutableJsonSnapshot(sparse)).toThrow(/空槽/u);
    expect(() => createImmutableJsonSnapshot(hidden)).toThrow(/不可枚举/u);
    expect(() => createImmutableJsonSnapshot({ [Symbol("hidden")]: true })).toThrow(/Symbol/u);
  });

  it("preserves prototype-like JSON keys as inert own data properties", () => {
    const value = JSON.parse('{"__proto__":{"polluted":true}}');
    const snapshot = createImmutableJsonSnapshot(value) as Record<string, unknown>;

    expect(Object.hasOwn(snapshot, "__proto__")).toBe(true);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
