import type {
  ApplicationAuditEvent,
  ApplicationIdempotencyRecord,
  StoredApplicationAggregate,
} from "./types.js";

export interface ApplicationRepositoryReader {
  findById(id: string): Promise<StoredApplicationAggregate | undefined>;
  findBySlug(slug: string): Promise<StoredApplicationAggregate | undefined>;
  findByClientId(clientId: string): Promise<StoredApplicationAggregate | undefined>;
  list(): Promise<StoredApplicationAggregate[]>;
  findIdempotencyRecord(keyHash: string): Promise<ApplicationIdempotencyRecord | undefined>;
  listAuditEvents(applicationId: string): Promise<ApplicationAuditEvent[]>;
}

export interface ApplicationRepositoryTransaction extends ApplicationRepositoryReader {
  insert(aggregate: StoredApplicationAggregate): Promise<void>;
  update(aggregate: StoredApplicationAggregate, expectedVersion: number): Promise<void>;
  insertIdempotencyRecord(record: ApplicationIdempotencyRecord): Promise<void>;
  appendAuditEvent(event: ApplicationAuditEvent): Promise<void>;
}

export interface ApplicationRepository {
  /** 执行只读快照，避免为 OIDC Client 查询占用 SQLite 写锁。 */
  read<T>(operation: (reader: ApplicationRepositoryReader) => Promise<T>): Promise<T>;
  transaction<T>(
    operation: (transaction: ApplicationRepositoryTransaction) => Promise<T>,
  ): Promise<T>;
  close?(): Promise<void>;
}

/**
 * 只暴露查询方法，避免调用方通过运行时强转绕过只读契约。
 * 返回值冻结后仍委托给同一个事务快照，但不会携带任何写方法。
 */
export function createApplicationRepositoryReader(
  reader: ApplicationRepositoryReader,
): ApplicationRepositoryReader {
  return Object.freeze({
    findById: (id: string) => reader.findById(id),
    findBySlug: (slug: string) => reader.findBySlug(slug),
    findByClientId: (clientId: string) => reader.findByClientId(clientId),
    list: () => reader.list(),
    findIdempotencyRecord: (keyHash: string) => reader.findIdempotencyRecord(keyHash),
    listAuditEvents: (applicationId: string) => reader.listAuditEvents(applicationId),
  });
}
