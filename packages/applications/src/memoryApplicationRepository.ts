import {
  ApplicationConflictError,
  ApplicationVersionConflictError,
  IdempotencyConflictError,
} from "./errors.js";
import type {
  ApplicationRepository,
  ApplicationRepositoryReader,
  ApplicationRepositoryTransaction,
} from "./repository.js";
import { createApplicationRepositoryReader } from "./repository.js";
import type {
  ApplicationAuditEvent,
  ApplicationIdempotencyRecord,
  StoredApplicationAggregate,
} from "./types.js";

interface MemoryApplicationState {
  aggregates: Map<string, StoredApplicationAggregate>;
  idempotencyRecords: Map<string, ApplicationIdempotencyRecord>;
  auditEvents: ApplicationAuditEvent[];
}

export interface MemoryApplicationRepositoryOptions {
  aggregates?: StoredApplicationAggregate[];
  idempotencyRecords?: ApplicationIdempotencyRecord[];
  auditEvents?: ApplicationAuditEvent[];
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneState(state: MemoryApplicationState): MemoryApplicationState {
  return {
    aggregates: new Map(
      [...state.aggregates.entries()].map(([id, aggregate]) => [id, cloneValue(aggregate)]),
    ),
    idempotencyRecords: new Map(
      [...state.idempotencyRecords.entries()].map(([key, record]) => [key, cloneValue(record)]),
    ),
    auditEvents: cloneValue(state.auditEvents),
  };
}

class MemoryApplicationTransaction implements ApplicationRepositoryTransaction {
  public constructor(private readonly state: MemoryApplicationState) {}

  public async findById(id: string): Promise<StoredApplicationAggregate | undefined> {
    const aggregate = this.state.aggregates.get(id);
    return aggregate === undefined ? undefined : cloneValue(aggregate);
  }

  public async findBySlug(slug: string): Promise<StoredApplicationAggregate | undefined> {
    for (const aggregate of this.state.aggregates.values()) {
      if (aggregate.application.slug === slug) {
        return cloneValue(aggregate);
      }
    }
    return undefined;
  }

  public async findByClientId(clientId: string): Promise<StoredApplicationAggregate | undefined> {
    for (const aggregate of this.state.aggregates.values()) {
      if (aggregate.clients.some((client) => client.clientId === clientId)) {
        return cloneValue(aggregate);
      }
    }
    return undefined;
  }

  public async list(): Promise<StoredApplicationAggregate[]> {
    return [...this.state.aggregates.values()]
      .sort((left, right) => {
        const createdAtOrder = right.application.createdAt.localeCompare(
          left.application.createdAt,
        );
        return createdAtOrder === 0
          ? left.application.id.localeCompare(right.application.id)
          : createdAtOrder;
      })
      .map(cloneValue);
  }

  public async insert(aggregate: StoredApplicationAggregate): Promise<void> {
    if (this.state.aggregates.has(aggregate.application.id)) {
      throw new ApplicationConflictError(`应用 ID 已存在: ${aggregate.application.id}`);
    }
    this.assertSlugAvailable(aggregate.application.slug);
    this.assertClientIdsAvailable(aggregate.clients.map((client) => client.clientId));
    this.state.aggregates.set(aggregate.application.id, cloneValue(aggregate));
  }

  public async update(
    aggregate: StoredApplicationAggregate,
    expectedVersion: number,
  ): Promise<void> {
    const current = this.state.aggregates.get(aggregate.application.id);
    if (current === undefined) {
      throw new ApplicationConflictError(`无法更新不存在的应用: ${aggregate.application.id}`);
    }
    if (current.application.version !== expectedVersion) {
      throw new ApplicationVersionConflictError(
        aggregate.application.id,
        expectedVersion,
        current.application.version,
      );
    }

    this.assertSlugAvailable(aggregate.application.slug, aggregate.application.id);
    this.assertClientIdsAvailable(
      aggregate.clients.map((client) => client.clientId),
      aggregate.application.id,
    );
    this.state.aggregates.set(aggregate.application.id, cloneValue(aggregate));
  }

  public async findIdempotencyRecord(
    keyHash: string,
  ): Promise<ApplicationIdempotencyRecord | undefined> {
    const record = this.state.idempotencyRecords.get(keyHash);
    return record === undefined ? undefined : cloneValue(record);
  }

  public async insertIdempotencyRecord(record: ApplicationIdempotencyRecord): Promise<void> {
    if (this.state.idempotencyRecords.has(record.keyHash)) {
      throw new IdempotencyConflictError();
    }
    this.state.idempotencyRecords.set(record.keyHash, cloneValue(record));
  }

  public async appendAuditEvent(event: ApplicationAuditEvent): Promise<void> {
    if (this.state.auditEvents.some((candidate) => candidate.id === event.id)) {
      throw new ApplicationConflictError(`审计事件 ID 已存在: ${event.id}`);
    }
    this.state.auditEvents.push(cloneValue(event));
  }

  public async listAuditEvents(applicationId: string): Promise<ApplicationAuditEvent[]> {
    return this.state.auditEvents
      .filter((event) => event.applicationId === applicationId)
      .map(cloneValue);
  }

  private assertSlugAvailable(slug: string, excludedApplicationId?: string): void {
    for (const aggregate of this.state.aggregates.values()) {
      if (
        aggregate.application.id !== excludedApplicationId &&
        aggregate.application.slug === slug
      ) {
        throw new ApplicationConflictError(`应用 slug 已存在: ${slug}`);
      }
    }
  }

  private assertClientIdsAvailable(clientIds: string[], excludedApplicationId?: string): void {
    if (new Set(clientIds).size !== clientIds.length) {
      throw new ApplicationConflictError("同一应用中存在重复的 OIDC client_id");
    }

    for (const aggregate of this.state.aggregates.values()) {
      if (aggregate.application.id === excludedApplicationId) {
        continue;
      }
      const existingClientIds = new Set(aggregate.clients.map((client) => client.clientId));
      const conflict = clientIds.find((clientId) => existingClientIds.has(clientId));
      if (conflict !== undefined) {
        throw new ApplicationConflictError(`OIDC client_id 已存在: ${conflict}`);
      }
    }
  }
}

export class MemoryApplicationRepository implements ApplicationRepository {
  private state: MemoryApplicationState;
  private transactionTail: Promise<void> = Promise.resolve();

  public constructor(options: MemoryApplicationRepositoryOptions = {}) {
    this.state = {
      aggregates: new Map(
        (options.aggregates ?? []).map((aggregate) => [
          aggregate.application.id,
          cloneValue(aggregate),
        ]),
      ),
      idempotencyRecords: new Map(
        (options.idempotencyRecords ?? []).map((record) => [record.keyHash, cloneValue(record)]),
      ),
      auditEvents: cloneValue(options.auditEvents ?? []),
    };
  }

  public async read<T>(operation: (reader: ApplicationRepositoryReader) => Promise<T>): Promise<T> {
    await this.transactionTail;
    return operation(
      createApplicationRepositoryReader(new MemoryApplicationTransaction(cloneState(this.state))),
    );
  }

  public async transaction<T>(
    operation: (transaction: ApplicationRepositoryTransaction) => Promise<T>,
  ): Promise<T> {
    let releaseTransaction: (() => void) | undefined;
    const previousTransaction = this.transactionTail;
    this.transactionTail = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });

    await previousTransaction;
    const transactionState = cloneState(this.state);

    try {
      const result = await operation(new MemoryApplicationTransaction(transactionState));
      this.state = transactionState;
      return result;
    } finally {
      releaseTransaction?.();
    }
  }
}
