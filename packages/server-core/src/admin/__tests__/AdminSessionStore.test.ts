import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdminLoginStateLimitError,
  AdminSessionStore,
  DistributedAdminSessionStore,
} from "../AdminSessionStore.js";

describe("AdminSessionStore", () => {
  const bindingHash = "a".repeat(64);

  afterEach(() => {
    vi.useRealTimers();
  });

  it("consumes login states only once", () => {
    const store = new AdminSessionStore(3600);
    const state = store.createLoginState("/admin/users", bindingHash);

    expect(store.consumeLoginState(state)).toEqual({
      returnTo: "/admin/users",
      bindingHash,
    });
    expect(store.consumeLoginState(state)).toBeNull();
  });

  it("expires stale login states", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new AdminSessionStore(3600, 1);
    const state = store.createLoginState("/admin/users", bindingHash);

    vi.advanceTimersByTime(1001);

    expect(store.consumeLoginState(state)).toBeNull();
  });

  it("rejects new login states without evicting active transactions", () => {
    const store = new AdminSessionStore(3600, 600, 2);
    const oldest = store.createLoginState("/admin/users", bindingHash);
    const middle = store.createLoginState("/admin/providers", bindingHash);

    expect(() => store.createLoginState("/admin/tokens", bindingHash)).toThrow(
      AdminLoginStateLimitError,
    );
    expect(store.consumeLoginState(oldest)?.returnTo).toBe("/admin/users");
    expect(store.consumeLoginState(middle)?.returnTo).toBe("/admin/providers");
  });

  it("rate limits repeated login starts by source or browser", () => {
    const store = new AdminSessionStore(3600, 600, 1000, 1000, 1, 60);

    store.checkLoginRateLimit(["source:one", "browser:one"]);
    expect(() => store.checkLoginRateLimit(["source:one", "browser:two"])).toThrow(
      AdminLoginStateLimitError,
    );
  });

  it("evicts the oldest admin session when the limit is reached", () => {
    const store = new AdminSessionStore(3600, 600, 1000, 2);
    const oldest = store.createSession("admin-1");
    const middle = store.createSession("admin-2");
    const newest = store.createSession("admin-3");

    expect(store.getSession(oldest.id)).toBeNull();
    expect(store.getSession(middle.id)?.userId).toBe("admin-2");
    expect(store.getSession(newest.id)?.userId).toBe("admin-3");
  });

  it("purges expired admin sessions before enforcing the session limit", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new AdminSessionStore(1, 600, 1000, 2);
    const expired = store.createSession("admin-1");

    vi.advanceTimersByTime(1001);
    const active = store.createSession("admin-2");
    const newest = store.createSession("admin-3");

    expect(store.getSession(expired.id)).toBeNull();
    expect(store.getSession(active.id)?.userId).toBe("admin-2");
    expect(store.getSession(newest.id)?.userId).toBe("admin-3");
  });
});

describe("DistributedAdminSessionStore", () => {
  const bindingHash = "a".repeat(64);

  it("uses shared state storage for sessions and atomically consumed login state", async () => {
    const values = new Map<string, unknown>();
    const boundedCollections = new Map<string, string[]>();
    const stateStore = {
      set: async (key: string, value: unknown) => {
        values.set(key, value);
      },
      setBounded: vi.fn(
        async (key: string, value: unknown, _ttl: number, collection: string, maxSize: number) => {
          const members = boundedCollections.get(collection) ?? [];
          members.push(key);
          while (members.length > maxSize) {
            values.delete(members.shift() ?? "");
          }
          boundedCollections.set(collection, members);
          values.set(key, value);
          return true;
        },
      ),
      get: async (key: string) => values.get(key) ?? null,
      take: async (key: string, collection?: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        if (collection) {
          boundedCollections.set(
            collection,
            (boundedCollections.get(collection) ?? []).filter((member) => member !== key),
          );
        }
        return value;
      },
      increment: vi.fn().mockResolvedValue(1),
      delete: async (key: string) => {
        values.delete(key);
      },
    };
    const store = new DistributedAdminSessionStore(stateStore, 3600);

    const session = await store.createSession("user-1");
    expect(await store.getSession(session.id)).toMatchObject({ userId: "user-1" });

    const loginState = await store.createLoginState("/admin/users", bindingHash);
    expect(stateStore.setBounded).toHaveBeenCalledWith(
      `admin:login-state:${loginState}`,
      { returnTo: "/admin/users", bindingHash },
      600,
      "admin:login-states",
      1000,
    );
    expect(await store.consumeLoginState(loginState)).toEqual({
      returnTo: "/admin/users",
      bindingHash,
    });
    expect(await store.consumeLoginState(loginState)).toBeNull();
  });

  it("rate limits custom state stores without bounded collection support", async () => {
    const stateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      take: vi.fn().mockResolvedValue(null),
      increment: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const store = new DistributedAdminSessionStore(stateStore, 3600, 600, 1);

    await expect(store.createLoginState("/admin/users", bindingHash)).resolves.toEqual(
      expect.any(String),
    );
    await expect(store.createLoginState("/admin/users", bindingHash)).rejects.toBeInstanceOf(
      AdminLoginStateLimitError,
    );
    expect(stateStore.set).toHaveBeenCalledTimes(1);
  });

  it("rejects a full shared collection without evicting existing state", async () => {
    const stateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      setBounded: vi.fn().mockResolvedValue(false),
      get: vi.fn().mockResolvedValue(null),
      take: vi.fn().mockResolvedValue(null),
      increment: vi.fn().mockResolvedValue(1),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const store = new DistributedAdminSessionStore(stateStore, 3600);

    await expect(store.createLoginState("/admin/users", bindingHash)).rejects.toBeInstanceOf(
      AdminLoginStateLimitError,
    );
    expect(stateStore.set).not.toHaveBeenCalled();
  });

  it("uses shared counters to rate limit source and browser", async () => {
    const stateStore = {
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      take: vi.fn().mockResolvedValue(null),
      increment: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    const store = new DistributedAdminSessionStore(stateStore, 3600, 600, 1000, 1, 60);

    await expect(store.checkLoginRateLimit(["source:one", "browser:one"])).rejects.toBeInstanceOf(
      AdminLoginStateLimitError,
    );
    expect(stateStore.increment).toHaveBeenCalledTimes(2);
  });
});
