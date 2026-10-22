import { randomBytes } from "node:crypto";
import type { StateStore } from "../types/auth.js";

interface Generation {
  id: string;
  blocked: boolean;
  expiresAt: number;
  blocks?: { token: string; committed: boolean }[];
}

export interface BffSessionBlockLease {
  commit(): void | Promise<void>;
  release(): void | Promise<void>;
}

export class BffSessionRevokedError extends Error {
  constructor() {
    super("BFF login was invalidated by an account lifecycle change");
  }
}

const memoryStores = new WeakMap<object, MemoryBffSessionRevocations>();

export function getMemoryBffSessionRevocations(
  owner: object,
  maxSessionTtlSeconds: number,
): MemoryBffSessionRevocations {
  let store = memoryStores.get(owner);
  if (!store) {
    store = new MemoryBffSessionRevocations(maxSessionTtlSeconds);
    memoryStores.set(owner, store);
  }
  return store;
}

export class MemoryBffSessionRevocations {
  private loginGeneration = randomBytes(32).toString("hex");
  private readonly users = new Map<string, Generation>();

  constructor(private readonly ttl = 3600) {}

  captureLoginGeneration(): string {
    return this.loginGeneration;
  }

  assertLoginGeneration(generation: string): void {
    if (generation !== this.loginGeneration) throw new BffSessionRevokedError();
  }

  getUserGeneration(userId: string): string {
    for (const [id, value] of this.users) {
      if (value.expiresAt <= Date.now()) this.users.delete(id);
    }
    let entry = this.users.get(userId);
    if (!entry) {
      entry = {
        id: randomBytes(32).toString("hex"),
        blocked: false,
        expiresAt: Date.now() + this.ttl * 1000,
      };
      this.users.set(userId, entry);
    }
    if (entry.blocked) throw new BffSessionRevokedError();
    entry.expiresAt = Date.now() + this.ttl * 1000;
    return entry.id;
  }

  isCurrent(userId: string, generation: string): boolean {
    const entry = this.users.get(userId);
    return !!entry && entry.expiresAt > Date.now() && !entry.blocked && entry.id === generation;
  }

  blockUser(userId: string): BffSessionBlockLease {
    const token = randomBytes(32).toString("hex");
    this.updateBlocks(userId, (blocks) => [...blocks, { token, committed: false }]);
    return {
      commit: () => {
        this.updateBlocks(userId, (blocks) =>
          blocks.map((block) => (block.token === token ? { ...block, committed: true } : block)),
        );
      },
      release: () => {
        this.updateBlocks(userId, (blocks) => blocks.filter((block) => block.token !== token));
      },
    };
  }

  allowUser(userId: string): void {
    // 恢复账号只释放已提交的停用标记，不能清除其它仍在执行的停用操作。
    this.updateBlocks(userId, (blocks) => blocks.filter((block) => !block.committed));
  }

  private updateBlocks(
    userId: string,
    transform: (blocks: NonNullable<Generation["blocks"]>) => NonNullable<Generation["blocks"]>,
  ): void {
    this.loginGeneration = randomBytes(32).toString("hex");
    const blocks = transform(this.users.get(userId)?.blocks ?? []);
    this.users.set(userId, {
      id: randomBytes(32).toString("hex"),
      blocked: blocks.length > 0,
      blocks,
      expiresAt: Date.now() + this.ttl * 1000,
    });
  }
}

/** 随机代际避免共享标记丢失后重建相同计数而恢复旧 cookie；CAS 防止续期覆盖撤销。 */
export class DistributedBffSessionRevocations {
  private readonly ttl: number;

  constructor(
    private readonly store: StateStore,
    maxSessionTtlSeconds: number,
  ) {
    if (!store.compareAndSet) {
      throw new Error("Distributed BFF sessions require StateStore.compareAndSet");
    }
    this.ttl = Math.max(600, Math.ceil(maxSessionTtlSeconds));
  }

  async captureLoginGeneration(): Promise<string> {
    return (await this.getOrCreate("bff:login-generation")).id;
  }

  async assertLoginGeneration(generation: string): Promise<void> {
    const current = await this.store.get("bff:login-generation");
    if (!isGeneration(current) || current.expiresAt <= Date.now() || current.id !== generation) {
      throw new BffSessionRevokedError();
    }
  }

  async getUserGeneration(userId: string): Promise<string> {
    const current = await this.getOrCreate(this.userKey(userId));
    if (current.blocked) throw new BffSessionRevokedError();
    return current.id;
  }

  async isCurrent(userId: string, generation: string): Promise<boolean> {
    const current = await this.store.get(this.userKey(userId));
    return (
      isGeneration(current) &&
      current.expiresAt > Date.now() &&
      !current.blocked &&
      current.id === generation
    );
  }

  async blockUser(userId: string): Promise<BffSessionBlockLease> {
    const token = randomBytes(32).toString("hex");
    await this.updateBlocks(userId, (blocks) => [...blocks, { token, committed: false }]);
    return {
      commit: async () => {
        await this.updateBlocks(userId, (blocks) =>
          blocks.map((block) => (block.token === token ? { ...block, committed: true } : block)),
        );
      },
      release: async () => {
        await this.updateBlocks(userId, (blocks) =>
          blocks.filter((block) => block.token !== token),
        );
      },
    };
  }

  async allowUser(userId: string): Promise<void> {
    await this.updateBlocks(userId, (blocks) => blocks.filter((block) => !block.committed));
  }

  private async updateBlocks(
    userId: string,
    transform: (blocks: NonNullable<Generation["blocks"]>) => NonNullable<Generation["blocks"]>,
  ): Promise<void> {
    await this.rotate("bff:login-generation", false);
    const key = this.userKey(userId);
    for (let attempt = 0; attempt < 32; attempt++) {
      const current = await this.store.get(key);
      const blocks = transform(isGeneration(current) ? (current.blocks ?? []) : []);
      const next = { ...this.next(blocks.length > 0), blocks };
      if (await this.store.compareAndSet!(key, current, next, this.ttl)) return;
    }
    throw new Error("Unable to atomically update BFF session generation");
  }

  private userKey(userId: string): string {
    return `bff:user-generation:${userId}`;
  }

  private next(blocked: boolean): Generation {
    return {
      id: randomBytes(32).toString("hex"),
      blocked,
      expiresAt: Date.now() + this.ttl * 1000,
    };
  }

  private async rotate(key: string, blocked: boolean): Promise<Generation> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const current = await this.store.get(key);
      const next = this.next(blocked);
      if (await this.store.compareAndSet!(key, current, next, this.ttl)) return next;
    }
    throw new Error("Unable to atomically rotate BFF session generation");
  }

  private async getOrCreate(key: string): Promise<Generation> {
    for (let attempt = 0; attempt < 32; attempt++) {
      const current = await this.store.get(key);
      if (isGeneration(current) && current.expiresAt > Date.now()) {
        if (current.blocked) return current;
        const renewed = { ...current, expiresAt: Date.now() + this.ttl * 1000 };
        if (await this.store.compareAndSet!(key, current, renewed, this.ttl)) return renewed;
      } else {
        const next = this.next(false);
        if (await this.store.compareAndSet!(key, current, next, this.ttl)) return next;
      }
    }
    throw new Error("Unable to atomically initialize BFF session generation");
  }
}

function isGeneration(value: unknown): value is Generation {
  if (!value || typeof value !== "object") return false;
  const entry = value as Generation;
  return (
    typeof entry.id === "string" &&
    /^[a-f0-9]{64}$/u.test(entry.id) &&
    typeof entry.blocked === "boolean" &&
    Number.isFinite(entry.expiresAt)
  );
}
