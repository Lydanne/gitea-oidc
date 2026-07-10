interface ClientBlockState {
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

const blockedClients = new Map<string, ClientBlockState>();

export class OidcClientRevokedError extends Error {
  public readonly code = "OIDC_CLIENT_REVOKED";

  public constructor() {
    super("OIDC Client 已禁用，拒绝写入新的授权记录");
    this.name = "OidcClientRevokedError";
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

export function assertOidcClientWriteAllowed(payload: unknown): void {
  const clientId = readOidcPayloadClientId(payload);
  const state = clientId === undefined ? undefined : blockedClients.get(clientId);
  if (state?.durable || (state?.leases.size ?? 0) > 0) {
    throw new OidcClientRevokedError();
  }
}

export function clearOidcClientRevocationBarriers(): void {
  blockedClients.clear();
}

function getOrCreateClientBlockState(clientId: string): ClientBlockState {
  const existing = blockedClients.get(clientId);
  if (existing) return existing;
  const state = { durable: false, leases: new Set<symbol>() };
  blockedClients.set(clientId, state);
  return state;
}

function removeUnusedClientBlockState(clientId: string, state: ClientBlockState): void {
  if (!state.durable && state.leases.size === 0 && blockedClients.get(clientId) === state) {
    blockedClients.delete(clientId);
  }
}
