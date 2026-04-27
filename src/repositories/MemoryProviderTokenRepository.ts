/**
 * 内存 Provider token 仓储
 */

import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenRecord,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi";

/**
 * 内存 Provider token 仓储
 */
export class MemoryProviderTokenRepository implements ProviderTokenRepository {
  private tokens = new Map<string, ProviderTokenRecord>();

  async upsert(record: ProviderTokenRecord): Promise<ProviderTokenRecord> {
    const id = this.createId(record.provider, record.ownerType, record.ownerId);
    const existing = this.tokens.get(id);
    const now = new Date();
    const saved: ProviderTokenRecord = {
      ...existing,
      ...record,
      id,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
    };

    this.tokens.set(id, this.clone(saved));
    return this.clone(saved);
  }

  async find(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<ProviderTokenRecord | null> {
    const record = this.tokens.get(this.createId(provider, ownerType, ownerId));
    return record ? this.clone(record) : null;
  }

  async list(options?: ProviderTokenListOptions): Promise<ProviderTokenRecord[]> {
    let records = Array.from(this.tokens.values());

    if (options?.provider) {
      records = records.filter((record) => record.provider === options.provider);
    }
    if (options?.ownerType) {
      records = records.filter((record) => record.ownerType === options.ownerType);
    }
    if (options?.ownerId) {
      records = records.filter((record) => record.ownerId === options.ownerId);
    }
    if (options?.status) {
      records = records.filter((record) => record.status === options.status);
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? records.length;
    return records.slice(offset, offset + limit).map((record) => this.clone(record));
  }

  async updateStatus(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
    status: ProviderTokenStatus,
    lastError?: string,
  ): Promise<void> {
    const id = this.createId(provider, ownerType, ownerId);
    const record = this.tokens.get(id);
    if (!record) {
      return;
    }

    this.tokens.set(id, {
      ...record,
      status,
      lastError,
      lastProbedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async delete(
    provider: string,
    ownerType: ProviderTokenOwnerType,
    ownerId: string,
  ): Promise<void> {
    this.tokens.delete(this.createId(provider, ownerType, ownerId));
  }

  async clear(): Promise<void> {
    this.tokens.clear();
  }

  private createId(provider: string, ownerType: ProviderTokenOwnerType, ownerId: string): string {
    return `${provider}:${ownerType}:${ownerId}`;
  }

  private clone(record: ProviderTokenRecord): ProviderTokenRecord {
    return {
      ...record,
      expiresAt: record.expiresAt ? new Date(record.expiresAt) : undefined,
      refreshExpiresAt: record.refreshExpiresAt ? new Date(record.refreshExpiresAt) : undefined,
      lastProbedAt: record.lastProbedAt ? new Date(record.lastProbedAt) : undefined,
      lastRefreshAt: record.lastRefreshAt ? new Date(record.lastRefreshAt) : undefined,
      createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : undefined,
      metadata: record.metadata ? { ...record.metadata } : undefined,
    };
  }
}
