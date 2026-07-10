import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminSessionStore, DistributedAdminSessionStore } from "../AdminSessionStore";

describe("AdminSessionStore", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("consumes login states only once", () => {
    const store = new AdminSessionStore(3600);
    const state = store.createLoginState("/admin/users");

    expect(store.consumeLoginState(state)).toBe("/admin/users");
    expect(store.consumeLoginState(state)).toBeNull();
  });

  it("expires stale login states", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const store = new AdminSessionStore(3600, 1);
    const state = store.createLoginState("/admin/users");

    vi.advanceTimersByTime(1001);

    expect(store.consumeLoginState(state)).toBeNull();
  });

  it("evicts the oldest login state when the limit is reached", () => {
    const store = new AdminSessionStore(3600, 600, 2);
    const oldest = store.createLoginState("/admin/users");
    const middle = store.createLoginState("/admin/providers");
    const newest = store.createLoginState("/admin/tokens");

    expect(store.consumeLoginState(oldest)).toBeNull();
    expect(store.consumeLoginState(middle)).toBe("/admin/providers");
    expect(store.consumeLoginState(newest)).toBe("/admin/tokens");
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
  it("uses shared state storage for sessions and atomically consumed login state", async () => {
    const values = new Map<string, unknown>();
    const stateStore = {
      set: async (key: string, value: unknown) => values.set(key, value),
      get: async (key: string) => values.get(key) ?? null,
      take: async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      },
      delete: async (key: string) => {
        values.delete(key);
      },
    };
    const store = new DistributedAdminSessionStore(stateStore, 3600);

    const session = await store.createSession("user-1");
    expect(await store.getSession(session.id)).toMatchObject({ userId: "user-1" });

    const loginState = await store.createLoginState("/admin/users");
    expect(await store.consumeLoginState(loginState)).toBe("/admin/users");
    expect(await store.consumeLoginState(loginState)).toBeNull();
  });
});
