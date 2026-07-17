export type JsonPrimitive = null | boolean | number | string;

export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type DeepReadonly<T> = T extends JsonPrimitive
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

const MAXIMUM_SNAPSHOT_DEPTH = 64;
const MAXIMUM_SNAPSHOT_NODES = 10_000;

/**
 * 创建可安全 JSON 序列化的深冻结快照。与 JSON stringify/parse 不同，非法值会被拒绝，
 * 不会被静默删除或转换。
 */
export function createImmutableJsonSnapshot<T>(value: T): DeepReadonly<T> {
  const ancestors = new WeakSet<object>();
  let nodeCount = 0;

  const clone = (current: unknown, path: string, depth: number): JsonValue => {
    nodeCount += 1;
    if (nodeCount > MAXIMUM_SNAPSHOT_NODES) {
      throw new TypeError("模板快照节点数量超过安全上限");
    }
    if (depth > MAXIMUM_SNAPSHOT_DEPTH) {
      throw new TypeError("模板快照嵌套层级超过安全上限");
    }

    if (current === null || typeof current === "string" || typeof current === "boolean") {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        throw new TypeError(`${path} 必须是有限数字`);
      }
      return current;
    }
    if (typeof current !== "object") {
      throw new TypeError(`${path} 不是 JSON-safe 值`);
    }
    if (ancestors.has(current)) {
      throw new TypeError(`${path} 包含循环引用`);
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const descriptors = Object.getOwnPropertyDescriptors(current);
        const extraKeys = Reflect.ownKeys(current).filter((key) => {
          if (key === "length") {
            return false;
          }
          return (
            typeof key !== "string" ||
            !/^(?:0|[1-9]\d*)$/u.test(key) ||
            Number(key) >= current.length
          );
        });
        if (extraKeys.length > 0) {
          throw new TypeError(`${path} 数组包含非 JSON 属性`);
        }

        const output: JsonValue[] = [];
        for (let index = 0; index < current.length; index += 1) {
          const descriptor = descriptors[index];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            throw new TypeError(`${path}[${index}] 不能是空槽或访问器属性`);
          }
          output.push(clone(descriptor.value, `${path}[${index}]`, depth + 1));
        }
        return Object.freeze(output);
      }

      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} 必须是普通 JSON 对象`);
      }

      const descriptors = Object.getOwnPropertyDescriptors(current);
      if (Reflect.ownKeys(current).some((key) => typeof key === "symbol")) {
        throw new TypeError(`${path} 不能包含 Symbol 属性`);
      }
      const output: Record<string, JsonValue> = {};
      for (const key of Object.getOwnPropertyNames(current).sort()) {
        const descriptor = descriptors[key];
        if (!descriptor?.enumerable) {
          throw new TypeError(`${path}.${key} 不能是不可枚举属性`);
        }
        if (!("value" in descriptor)) {
          throw new TypeError(`${path}.${key} 不能使用 getter 或 setter`);
        }
        Object.defineProperty(output, key, {
          configurable: false,
          enumerable: true,
          value: clone(descriptor.value, `${path}.${key}`, depth + 1),
          writable: false,
        });
      }
      return Object.freeze(output);
    } finally {
      ancestors.delete(current);
    }
  };

  return clone(value, "$", 0) as DeepReadonly<T>;
}
