import { describe, expect, it, vi } from "vitest";
import {
  MemoryAuthSessionStore,
  MemoryLoginTransactionStore,
  MemoryRefreshLock,
} from "../adapters/memoryStores.js";
import type { LoginTransaction, SensitiveAuthSessionRecord } from "../domain/types.js";

const opaque = (character: string) => character.repeat(43);
const OWNER = "owner-v1:test-owner";
const OTHER_OWNER = "owner-v1:other-owner";

const transaction = (now: number): LoginTransaction => ({
  ownerNamespace: OWNER,
  transactionId: opaque("t"),
  state: opaque("s"),
  nonce: opaque("n"),
  codeVerifier: opaque("v"),
  redirectUri: "https://app.example.com/oidc/callback",
  returnTo: "/dashboard",
  scopes: ["openid"],
  resources: [],
  createdAt: now,
  expiresAt: now + 1_000,
});

const session = (now: number): SensitiveAuthSessionRecord => ({
  ownerNamespace: OWNER,
  sessionId: opaque("i"),
  subject: "user-1",
  user: { subject: "user-1", groups: ["developers"] },
  scopes: ["openid", "offline_access"],
  resources: [],
  tokens: {
    accessToken: "access-token",
    tokenType: "Bearer",
    refreshToken: "refresh-token",
    idToken: "id-token",
  },
  refreshVersion: 0,
  createdAt: now,
  updatedAt: now,
  expiresAt: now + 1_000,
});

describe("MemoryLoginTransactionStore", () => {
  it("creates and atomically consumes a transaction only once", async () => {
    const store = new MemoryLoginTransactionStore({ clock: () => 1_000 });
    const value = transaction(1_000);

    await expect(store.create(value)).resolves.toBe(true);
    await expect(store.create(value)).resolves.toBe(false);
    const consumed = await store.consume(OWNER, value.transactionId);
    expect(consumed).toEqual(value);
    await expect(store.consume(OWNER, value.transactionId)).resolves.toBeNull();
  });

  it("does not return expired transactions and bounds memory capacity", async () => {
    let now = 1_000;
    const store = new MemoryLoginTransactionStore({ maxEntries: 1, clock: () => now });
    await store.create(transaction(now));
    await expect(store.create({ ...transaction(now), transactionId: opaque("x") })).rejects.toThrow(
      "capacity",
    );

    now = 2_001;
    await expect(store.consume(OWNER, opaque("t"))).resolves.toBeNull();
    await expect(store.create({ ...transaction(now), transactionId: opaque("x") })).resolves.toBe(
      true,
    );
  });

  it("returns defensive copies and rejects use after close", async () => {
    const store = new MemoryLoginTransactionStore({ clock: () => 1_000 });
    const value = transaction(1_000);
    await store.create(value);
    (value.scopes as string[])[0] = "mutated";
    expect((await store.consume(OWNER, value.transactionId))?.scopes).toEqual(["openid"]);

    store.close();
    await expect(store.consume(OWNER, value.transactionId)).rejects.toThrow("closed");
  });

  it("isolates identical transaction IDs by owner namespace", async () => {
    const store = new MemoryLoginTransactionStore({ clock: () => 1_000 });
    const first = transaction(1_000);
    const second = { ...first, ownerNamespace: OTHER_OWNER };

    await expect(store.create(first)).resolves.toBe(true);
    await expect(store.create(second)).resolves.toBe(true);
    await expect(store.consume(OTHER_OWNER, first.transactionId)).resolves.toEqual(second);
    await expect(store.consume(OWNER, first.transactionId)).resolves.toEqual(first);
  });
});

describe("MemoryAuthSessionStore", () => {
  it("uses refreshVersion compare-and-swap and never recreates deleted sessions", async () => {
    const store = new MemoryAuthSessionStore({ clock: () => 1_000 });
    const value = session(1_000);
    await store.create(value);
    const next = { ...value, refreshVersion: 1, updatedAt: 1_100 };

    await expect(store.compareAndSwap(OWNER, value.sessionId, 9, next)).resolves.toBe(false);
    await expect(store.compareAndSwap(OWNER, value.sessionId, 0, next)).resolves.toBe(true);
    expect((await store.get(OWNER, value.sessionId))?.refreshVersion).toBe(1);

    await store.delete(OWNER, value.sessionId);
    await expect(store.compareAndSwap(OWNER, value.sessionId, 1, next)).resolves.toBe(false);
    await expect(store.get(OWNER, value.sessionId)).resolves.toBeNull();
  });

  it("returns defensive copies and removes expired sessions", async () => {
    let now = 1_000;
    const store = new MemoryAuthSessionStore({ clock: () => now });
    const value = session(now);
    await store.create(value);
    value.tokens.accessToken = "mutated";
    (value.user.groups as string[])[0] = "mutated";
    const stored = await store.get(OWNER, value.sessionId);
    expect(stored?.tokens.accessToken).toBe("access-token");
    expect(stored?.user.groups).toEqual(["developers"]);

    now = 2_001;
    await expect(store.get(OWNER, value.sessionId)).resolves.toBeNull();
  });

  it("isolates sessions by owner and deletes only the expected refresh version", async () => {
    const store = new MemoryAuthSessionStore({ clock: () => 1_000 });
    const first = session(1_000);
    const second = { ...first, ownerNamespace: OTHER_OWNER };
    await store.create(first);
    await store.create(second);

    await expect(store.get(OTHER_OWNER, first.sessionId)).resolves.toEqual(second);
    await expect(store.deleteIfVersion(OWNER, first.sessionId, 9)).resolves.toBe(false);
    await expect(store.get(OWNER, first.sessionId)).resolves.toEqual(first);
    await expect(store.deleteIfVersion(OWNER, first.sessionId, 0)).resolves.toBe(true);
    await expect(store.get(OWNER, first.sessionId)).resolves.toBeNull();
    await expect(store.get(OTHER_OWNER, first.sessionId)).resolves.toEqual(second);
  });
});

describe("MemoryRefreshLock", () => {
  it("serializes the same session while allowing errors to release the lock", async () => {
    const lock = new MemoryRefreshLock();
    const events: string[] = [];
    let releaseFirst = () => {};
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = lock.runExclusive(OWNER, "session", async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
      throw new Error("expected");
    });
    const secondOperation = vi.fn(async () => {
      events.push("second");
      return 2;
    });
    const second = lock.runExclusive(OWNER, "session", secondOperation);

    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    releaseFirst();
    await expect(first).rejects.toThrow("expected");
    await expect(second).resolves.toBe(2);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("waits for active operations during close and rejects new work", async () => {
    const lock = new MemoryRefreshLock();
    const operation = lock.runExclusive(OWNER, "session", async () => 1);
    await lock.close();
    await expect(operation).resolves.toBe(1);
    await expect(lock.runExclusive(OWNER, "session", async () => 2)).rejects.toThrow("closed");
  });
});
