/**
 * 内存 Provider token 仓储
 */

import type {
  ProviderTokenListOptions,
  ProviderTokenOwnerType,
  ProviderTokenProbeCandidateOptions,
  ProviderTokenRecord,
  ProviderTokenRepository,
  ProviderTokenStatus,
} from "../types/providerApi";
import { sanitizeTokenErrorText } from "../utils/tokenCrypto";
import {
  normalizeProviderTokenListOptions,
  normalizeProviderTokenProbeCandidateOptions,
} from "./providerTokenListOptions";

/**
 * 内存 Provider token 仓储
 */
export class MemoryProviderTokenRepository implements ProviderTokenRepository {
  private tokens = new Map<string, ProviderTokenRecord>();

  async upsert(record: ProviderTokenRecord): Promise<ProviderTokenRecord> {
    const id = this.createId(record.provider, record.ownerType, record.ownerId);
    const existing = this.tokens.get(id);
    const now = new Date();
    const lastErrorSource = Object.hasOwn(record, "lastError")
      ? record.lastError
      : existing?.lastError;
    const saved: ProviderTokenRecord = {
      ...existing,
      ...record,
      id,
      lastError: sanitizeTokenErrorText(lastErrorSource),
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
    const listOptions = normalizeProviderTokenListOptions(options);
    let records = Array.from(this.tokens.values());

    if (listOptions.provider) {
      records = records.filter((record) => record.provider === listOptions.provider);
    }
    if (listOptions.ownerType) {
      records = records.filter((record) => record.ownerType === listOptions.ownerType);
    }
    if (listOptions.ownerId) {
      records = records.filter((record) => record.ownerId === listOptions.ownerId);
    }
    if (listOptions.status) {
      records = records.filter((record) => record.status === listOptions.status);
    }

    const offset = listOptions.offset ?? 0;
    const limit = listOptions.limit ?? records.length;
    return records.slice(offset, offset + limit).map((record) => this.clone(record));
  }

  async listProbeCandidates(
    options: ProviderTokenProbeCandidateOptions,
  ): Promise<ProviderTokenRecord[]> {
    const probeOptions = normalizeProviderTokenProbeCandidateOptions(options);
    const expiresBefore = probeOptions.expiresBefore.getTime();

    return Array.from(this.tokens.values())
      .filter((record) => this.shouldProbe(record, expiresBefore))
      .sort(compareProbeCandidates)
      .slice(0, probeOptions.limit)
      .map((record) => this.clone(record));
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
      lastError: sanitizeTokenErrorText(lastError),
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

  async deleteByOwnerId(ownerId: string): Promise<void> {
    for (const [id, token] of this.tokens.entries()) {
      if (token.ownerId === ownerId) {
        this.tokens.delete(id);
      }
    }
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
      lastError: sanitizeTokenErrorText(record.lastError),
      createdAt: record.createdAt ? new Date(record.createdAt) : undefined,
      updatedAt: record.updatedAt ? new Date(record.updatedAt) : undefined,
      metadata: record.metadata ? { ...record.metadata } : undefined,
    };
  }

  private shouldProbe(record: ProviderTokenRecord, expiresBefore: number): boolean {
    if (record.status === "revoked") {
      return false;
    }

    return (
      record.status !== "valid" ||
      !record.lastProbedAt ||
      !record.expiresAt ||
      record.expiresAt.getTime() <= expiresBefore
    );
  }
}

function compareProbeCandidates(left: ProviderTokenRecord, right: ProviderTokenRecord): number {
  return (
    getProbePriority(left) - getProbePriority(right) ||
    getTime(left.lastProbedAt) - getTime(right.lastProbedAt) ||
    getTime(left.expiresAt) - getTime(right.expiresAt) ||
    getTime(left.updatedAt) - getTime(right.updatedAt)
  );
}

function getProbePriority(record: ProviderTokenRecord): number {
  if (record.status !== "valid") {
    return 0;
  }
  if (!record.lastProbedAt) {
    return 1;
  }
  if (!record.expiresAt) {
    return 2;
  }
  return 3;
}

function getTime(value?: Date): number {
  return value?.getTime() ?? 0;
}
