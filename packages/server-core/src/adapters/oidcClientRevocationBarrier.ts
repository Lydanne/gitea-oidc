interface ClientBlockState {
  durable: boolean;
  leases: Set<symbol>;
}

interface AccountBlockState {
  durable: boolean;
  leases: Set<symbol>;
}

export interface OidcClientBlockLease {
  readonly clientId: string;
  /** 状态转换提交后把临时栅栏提升为持久栅栏。 */
  commit(): void;
  /** 状态转换失败时只释放当前调用持有的临时栅栏。 */
  release(): void;
}

export interface OidcAccountBlockLease {
  readonly accountId: string;
  /** 用户状态提交后把临时栅栏提升为持久栅栏。 */
  commit(): void | Promise<void>;
  /** 用户状态转换失败时只释放当前调用持有的临时栅栏。 */
  release(): void | Promise<void>;
}

const blockedClients = new Map<string, ClientBlockState>();
const blockedAccounts = new Map<string, AccountBlockState>();

export class OidcClientRevokedError extends Error {
  public readonly code = "OIDC_CLIENT_REVOKED";

  public constructor() {
    super("OIDC Client 已禁用，拒绝写入新的授权记录");
    this.name = "OidcClientRevokedError";
  }
}

export class OidcAccountRevokedError extends Error {
  public readonly code = "OIDC_ACCOUNT_REVOKED";

  public constructor() {
    super("OIDC 账户已禁用，拒绝写入新的授权记录");
    this.name = "OidcAccountRevokedError";
  }
}

/** 从 oidc-provider 常见模型载荷中提取关联 Client。 */
export function readOidcPayloadClientId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const params =
    record.params !== null && typeof record.params === "object" && !Array.isArray(record.params)
      ? (record.params as Record<string, unknown>)
      : undefined;
  const clientId = record.clientId ?? record.client_id ?? params?.client_id;
  return typeof clientId === "string" && clientId !== "" ? clientId : undefined;
}

/** 从 oidc-provider 常见模型载荷中提取关联账户。 */
export function readOidcPayloadAccountId(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const accountId = (payload as Record<string, unknown>).accountId;
  return typeof accountId === "string" && accountId !== "" ? accountId : undefined;
}

/**
 * 在状态转换前取得独立租约。并发调用只能释放自己的租约，不能误开其他调用的栅栏。
 */
export function acquireOidcClientBlock(clientId: string): OidcClientBlockLease {
  const state = getOrCreateClientBlockState(clientId);
  const token = Symbol(clientId);
  state.leases.add(token);
  let settled = false;

  return Object.freeze({
    clientId,
    commit(): void {
      if (settled) return;
      settled = true;
      if (blockedClients.get(clientId) !== state || !state.leases.delete(token)) return;
      state.durable = true;
    },
    release(): void {
      if (settled) return;
      settled = true;
      if (blockedClients.get(clientId) !== state || !state.leases.delete(token)) return;
      removeUnusedClientBlockState(clientId, state);
    },
  });
}

/** 在用户状态转换前取得独立账户栅栏租约。 */
export function acquireOidcAccountBlock(accountId: string): OidcAccountBlockLease {
  const state = getOrCreateAccountBlockState(accountId);
  const token = Symbol(accountId);
  state.leases.add(token);
  let settled = false;

  return Object.freeze({
    accountId,
    commit(): void {
      if (settled) return;
      settled = true;
      if (blockedAccounts.get(accountId) !== state || !state.leases.delete(token)) return;
      state.durable = true;
    },
    release(): void {
      if (settled) return;
      settled = true;
      if (blockedAccounts.get(accountId) !== state || !state.leases.delete(token)) return;
      removeUnusedAccountBlockState(accountId, state);
    },
  });
}

/** 撤销开始后设置持久栅栏，直到应用显式重新启用。 */
export function blockOidcClient(clientId: string): void {
  getOrCreateClientBlockState(clientId).durable = true;
}

/** 应用重新启用后移除持久栅栏；仍有禁用租约时继续拒绝写入。 */
export function allowOidcClient(clientId: string): void {
  const state = blockedClients.get(clientId);
  if (!state) return;
  state.durable = false;
  removeUnusedClientBlockState(clientId, state);
}

/** 用户重新启用后移除持久账户栅栏；仍有停用租约时继续拒绝写入。 */
export function allowOidcAccount(accountId: string): void {
  const state = blockedAccounts.get(accountId);
  if (!state) return;
  state.durable = false;
  removeUnusedAccountBlockState(accountId, state);
}

export function assertOidcClientWriteAllowed(payload: unknown): void {
  const clientId = readOidcPayloadClientId(payload);
  const state = clientId === undefined ? undefined : blockedClients.get(clientId);
  if (state?.durable || (state?.leases.size ?? 0) > 0) {
    throw new OidcClientRevokedError();
  }
}

export function assertOidcAccountWriteAllowed(payload: unknown): void {
  const accountId = readOidcPayloadAccountId(payload);
  const state = accountId === undefined ? undefined : blockedAccounts.get(accountId);
  if (state?.durable || (state?.leases.size ?? 0) > 0) {
    throw new OidcAccountRevokedError();
  }
}

export function assertOidcWriteAllowed(payload: unknown): void {
  assertOidcClientWriteAllowed(payload);
  assertOidcAccountWriteAllowed(payload);
}

export function clearOidcClientRevocationBarriers(): void {
  blockedClients.clear();
  blockedAccounts.clear();
}

function getOrCreateClientBlockState(clientId: string): ClientBlockState {
  const existing = blockedClients.get(clientId);
  if (existing) return existing;
  const state = { durable: false, leases: new Set<symbol>() };
  blockedClients.set(clientId, state);
  return state;
}

function getOrCreateAccountBlockState(accountId: string): AccountBlockState {
  const existing = blockedAccounts.get(accountId);
  if (existing) return existing;
  const state = { durable: false, leases: new Set<symbol>() };
  blockedAccounts.set(accountId, state);
  return state;
}

function removeUnusedClientBlockState(clientId: string, state: ClientBlockState): void {
  if (!state.durable && state.leases.size === 0 && blockedClients.get(clientId) === state) {
    blockedClients.delete(clientId);
  }
}

function removeUnusedAccountBlockState(accountId: string, state: AccountBlockState): void {
  if (!state.durable && state.leases.size === 0 && blockedAccounts.get(accountId) === state) {
    blockedAccounts.delete(accountId);
  }
}
