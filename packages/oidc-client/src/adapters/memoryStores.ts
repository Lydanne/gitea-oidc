import type { LoginTransaction, SensitiveAuthSessionRecord } from "../domain/types.js";
import type { RefreshLock } from "../ports/refreshLock.js";
import type { AuthSessionStore } from "../ports/sessionStore.js";
import type { LoginTransactionStore } from "../ports/transactionStore.js";

interface MemoryStoreOptions {
  maxEntries?: number;
  clock?: () => number;
}

const DEFAULT_MAX_ENTRIES = 10_000;

const validateMaxEntries = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError("maxEntries must be a positive safe integer");
  }
  return value;
};

const cloneTransaction = (transaction: LoginTransaction): LoginTransaction => ({
  ...transaction,
  scopes: [...transaction.scopes],
  resources: [...transaction.resources],
});

const cloneSession = (session: SensitiveAuthSessionRecord): SensitiveAuthSessionRecord => ({
  ...session,
  user: {
    ...session.user,
    groups: session.user.groups ? [...session.user.groups] : undefined,
  },
  scopes: [...session.scopes],
  resources: [...session.resources],
  tokens: { ...session.tokens },
});

const ownedKey = (ownerNamespace: string, opaqueId: string): string =>
  JSON.stringify([ownerNamespace, opaqueId]);

export class MemoryLoginTransactionStore implements LoginTransactionStore {
  readonly #transactions = new Map<string, LoginTransaction>();
  readonly #maxEntries: number;
  readonly #clock: () => number;
  #closed = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.#maxEntries = validateMaxEntries(options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.#clock = options.clock ?? Date.now;
  }

  async create(transaction: LoginTransaction): Promise<boolean> {
    this.#assertOpen();
    this.#pruneExpired();
    const key = ownedKey(transaction.ownerNamespace, transaction.transactionId);
    if (this.#transactions.has(key)) {
      return false;
    }
    if (this.#transactions.size >= this.#maxEntries) {
      throw new Error("transaction store capacity exceeded");
    }
    this.#transactions.set(key, cloneTransaction(transaction));
    return true;
  }

  async consume(ownerNamespace: string, transactionId: string): Promise<LoginTransaction | null> {
    this.#assertOpen();
    const key = ownedKey(ownerNamespace, transactionId);
    const transaction = this.#transactions.get(key);
    this.#transactions.delete(key);
    if (
      !transaction ||
      transaction.ownerNamespace !== ownerNamespace ||
      transaction.expiresAt <= this.#clock()
    ) {
      return null;
    }
    return cloneTransaction(transaction);
  }

  close(): void {
    this.#closed = true;
    this.#transactions.clear();
  }

  #pruneExpired(): void {
    const now = this.#clock();
    for (const [key, transaction] of this.#transactions) {
      if (transaction.expiresAt <= now) {
        this.#transactions.delete(key);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("transaction store is closed");
    }
  }
}

export class MemoryAuthSessionStore implements AuthSessionStore {
  readonly #sessions = new Map<string, SensitiveAuthSessionRecord>();
  readonly #maxEntries: number;
  readonly #clock: () => number;
  #closed = false;

  constructor(options: MemoryStoreOptions = {}) {
    this.#maxEntries = validateMaxEntries(options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.#clock = options.clock ?? Date.now;
  }

  async create(session: SensitiveAuthSessionRecord): Promise<boolean> {
    this.#assertOpen();
    this.#pruneExpired();
    const key = ownedKey(session.ownerNamespace, session.sessionId);
    if (this.#sessions.has(key)) {
      return false;
    }
    if (this.#sessions.size >= this.#maxEntries) {
      throw new Error("session store capacity exceeded");
    }
    this.#sessions.set(key, cloneSession(session));
    return true;
  }

  async get(ownerNamespace: string, sessionId: string): Promise<SensitiveAuthSessionRecord | null> {
    this.#assertOpen();
    const key = ownedKey(ownerNamespace, sessionId);
    const session = this.#sessions.get(key);
    if (!session || session.ownerNamespace !== ownerNamespace) {
      return null;
    }
    if (session.expiresAt <= this.#clock()) {
      this.#sessions.delete(key);
      return null;
    }
    return cloneSession(session);
  }

  async compareAndSwap(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
    next: SensitiveAuthSessionRecord,
  ): Promise<boolean> {
    this.#assertOpen();
    const key = ownedKey(ownerNamespace, sessionId);
    const current = this.#sessions.get(key);
    if (
      !current ||
      current.ownerNamespace !== ownerNamespace ||
      current.refreshVersion !== expectedRefreshVersion ||
      next.ownerNamespace !== ownerNamespace ||
      next.sessionId !== sessionId
    ) {
      return false;
    }
    if (next.expiresAt <= this.#clock()) {
      this.#sessions.delete(key);
      return false;
    }
    this.#sessions.set(key, cloneSession(next));
    return true;
  }

  async deleteIfVersion(
    ownerNamespace: string,
    sessionId: string,
    expectedRefreshVersion: number,
  ): Promise<boolean> {
    this.#assertOpen();
    const key = ownedKey(ownerNamespace, sessionId);
    const current = this.#sessions.get(key);
    if (
      !current ||
      current.ownerNamespace !== ownerNamespace ||
      current.refreshVersion !== expectedRefreshVersion
    ) {
      return false;
    }
    this.#sessions.delete(key);
    return true;
  }

  async delete(ownerNamespace: string, sessionId: string): Promise<void> {
    this.#assertOpen();
    this.#sessions.delete(ownedKey(ownerNamespace, sessionId));
  }

  close(): void {
    this.#closed = true;
    this.#sessions.clear();
  }

  #pruneExpired(): void {
    const now = this.#clock();
    for (const [key, session] of this.#sessions) {
      if (session.expiresAt <= now) {
        this.#sessions.delete(key);
      }
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new Error("session store is closed");
    }
  }
}

export class MemoryRefreshLock implements RefreshLock {
  readonly #tails = new Map<string, Promise<void>>();
  #closed = false;

  async runExclusive<T>(
    ownerNamespace: string,
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#closed) {
      throw new Error("refresh lock is closed");
    }

    const key = ownedKey(ownerNamespace, sessionId);
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#tails.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#tails.get(key) === current) {
        this.#tails.delete(key);
      }
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#tails.values()]);
    this.#tails.clear();
  }
}
