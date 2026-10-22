/**
 * Redis OIDC 适配器
 *
 * 使用 Redis 作为 OIDC Provider 的持久化存储
 * 适合高并发和分布式部署场景
 */

import { randomBytes } from "crypto";
import type { Adapter } from "oidc-provider";
import { createClient } from "redis";
import {
  type OidcAccountBlockLease,
  OidcAccountRevokedError,
  type OidcClientBlockLease,
  OidcClientRevokedError,
  OidcGrantRevokedError,
  readOidcPayloadAccountIds,
  readOidcPayloadClientId,
  requiresOidcGrant,
} from "./oidcClientRevocationBarrier.js";

const BLOCK_LEASE_TTL_SECONDS = 900;

const READ_ACCOUNT_IDS_LUA = [
  "local function readAccountIds(payload)",
  "  local accounts = {}",
  "  local function add(value)",
  "    if type(value) == 'string' and value ~= '' then accounts[value] = true end",
  "  end",
  "  if type(payload) ~= 'table' then return accounts end",
  "  add(payload.accountId)",
  "  if type(payload.result) == 'table' and type(payload.result.login) == 'table' then add(payload.result.login.accountId) end",
  "  if type(payload.lastSubmission) == 'table' and type(payload.lastSubmission.login) == 'table' then add(payload.lastSubmission.login.accountId) end",
  "  if type(payload.session) == 'table' then add(payload.session.accountId) end",
  "  return accounts",
  "end",
];

const UPSERT_BOUND_RECORD_SCRIPT = [
  ...READ_ACCOUNT_IDS_LUA,
  "for index = 1, tonumber(ARGV[6]) do",
  "  local keyIndex = index == 1 and 2 or index * 2 + 2",
  "  if redis.call('EXISTS', KEYS[keyIndex]) == 1 or redis.call('EXISTS', KEYS[keyIndex + 1]) == 1 then return 0 end",
  "end",
  "if ARGV[7] == '1' and (redis.call('EXISTS', KEYS[4]) == 1 or redis.call('EXISTS', KEYS[5]) == 1) then",
  "  return -1",
  "end",
  "local keyPrefix = ARGV[1]",
  "local name = ARGV[2]",
  "local id = ARGV[3]",
  "local value = ARGV[4]",
  "local expiresIn = tonumber(ARGV[5])",
  "local nextPayload = cjson.decode(value)",
  "local member = name .. ':' .. id",
  "local function readClientId(payload)",
  "  if type(payload) ~= 'table' then return nil end",
  "  if payload.clientId then return payload.clientId end",
  "  if payload.client_id then return payload.client_id end",
  "  if type(payload.params) == 'table' then return payload.params.client_id end",
  "  return nil",
  "end",
  "if ARGV[8] == '1' then",
  "  local grantKeyIndex = 6 + math.max(0, tonumber(ARGV[6]) - 1) * 2",
  "  local grantValue = redis.call('GET', KEYS[grantKeyIndex])",
  "  if not grantValue then return -2 end",
  "  local decoded, grantPayload = pcall(cjson.decode, grantValue)",
  "  if not decoded or type(grantPayload) ~= 'table' or not readClientId(nextPayload) or grantPayload.accountId ~= nextPayload.accountId or readClientId(grantPayload) ~= readClientId(nextPayload) then return -2 end",
  "end",
  "local function deleteStringIndexIfOwned(key)",
  "  if redis.call('GET', key) == id then redis.call('DEL', key) end",
  "end",
  "local function addSetIndex(key, indexMember)",
  "  local previousTtl = redis.call('TTL', key)",
  "  redis.call('SADD', key, indexMember)",
  "  if expiresIn > 0 then",
  "    if previousTtl == -2 or (previousTtl >= 0 and previousTtl < expiresIn) then",
  "      redis.call('EXPIRE', key, expiresIn)",
  "    end",
  "  elseif previousTtl >= 0 then",
  "    redis.call('PERSIST', key)",
  "  end",
  "end",
  "local previousValue = redis.call('GET', KEYS[1])",
  "if previousValue then",
  "  local decoded, previousPayload = pcall(cjson.decode, previousValue)",
  "  if decoded then",
  "    if previousPayload.userCode and previousPayload.userCode ~= nextPayload.userCode then",
  "      deleteStringIndexIfOwned(keyPrefix .. 'userCode:' .. previousPayload.userCode)",
  "    end",
  "    if previousPayload.uid and previousPayload.uid ~= nextPayload.uid then",
  "      deleteStringIndexIfOwned(keyPrefix .. 'uid:' .. previousPayload.uid)",
  "    end",
  "    if previousPayload.grantId and previousPayload.grantId ~= nextPayload.grantId then",
  "      redis.call('SREM', keyPrefix .. name .. ':grantId:' .. previousPayload.grantId, id)",
  "    end",
  "    local nextAccounts = readAccountIds(nextPayload)",
  "    for accountId in pairs(readAccountIds(previousPayload)) do",
  "      if not nextAccounts[accountId] then redis.call('SREM', keyPrefix .. 'accountId:' .. accountId, member) end",
  "    end",
  "    local previousClientId = readClientId(previousPayload)",
  "    local nextClientId = readClientId(nextPayload)",
  "    if previousClientId and previousClientId ~= nextClientId then",
  "      redis.call('SREM', keyPrefix .. 'clientId:' .. previousClientId, member)",
  "    end",
  "  end",
  "end",
  "if expiresIn ~= 0 then",
  "  redis.call('SETEX', KEYS[1], expiresIn, value)",
  "else",
  "  redis.call('SET', KEYS[1], value)",
  "end",
  "if nextPayload.userCode then",
  "  local userCodeKey = keyPrefix .. 'userCode:' .. nextPayload.userCode",
  "  if expiresIn ~= 0 then redis.call('SETEX', userCodeKey, expiresIn, id)",
  "  else redis.call('SET', userCodeKey, id) end",
  "end",
  "if nextPayload.uid then",
  "  local uidKey = keyPrefix .. 'uid:' .. nextPayload.uid",
  "  if expiresIn ~= 0 then redis.call('SETEX', uidKey, expiresIn, id)",
  "  else redis.call('SET', uidKey, id) end",
  "end",
  "if nextPayload.grantId then",
  "  addSetIndex(keyPrefix .. name .. ':grantId:' .. nextPayload.grantId, id)",
  "end",
  "for accountId in pairs(readAccountIds(nextPayload)) do addSetIndex(keyPrefix .. 'accountId:' .. accountId, member) end",
  "local clientId = readClientId(nextPayload)",
  "if clientId then addSetIndex(keyPrefix .. 'clientId:' .. clientId, member) end",
  "return 1",
].join("\n");

/** 每次只检查并清理一条记录，兼容旧版本未建立账户索引的 Interaction。 */
const DELETE_ACCOUNT_RECORD_LUA = [
  ...READ_ACCOUNT_IDS_LUA,
  "local function deleteAccountRecord(keyPrefix, key, model, id, accountId)",
  "  if redis.call('TYPE', key).ok ~= 'string' then return 0 end",
  "  local value = redis.call('GET', key)",
  "  if not value then return 0 end",
  "  local decoded, payload = pcall(cjson.decode, value)",
  "  if not decoded or not readAccountIds(payload)[accountId] then return 0 end",
  "  local member = model .. ':' .. id",
  "  for account in pairs(readAccountIds(payload)) do redis.call('SREM', keyPrefix .. 'accountId:' .. account, member) end",
  "  local clientId = payload.clientId or payload.client_id",
  "  if not clientId and type(payload.params) == 'table' then clientId = payload.params.client_id end",
  "  if type(clientId) == 'string' then redis.call('SREM', keyPrefix .. 'clientId:' .. clientId, member) end",
  "  if type(payload.grantId) == 'string' then redis.call('SREM', keyPrefix .. model .. ':grantId:' .. payload.grantId, id) end",
  "  for _, field in ipairs({'uid', 'userCode'}) do",
  "    if type(payload[field]) == 'string' then",
  "      local indexKey = keyPrefix .. field .. ':' .. payload[field]",
  "      if redis.call('GET', indexKey) == id then redis.call('DEL', indexKey) end",
  "    end",
  "  end",
  "  return redis.call('DEL', key)",
  "end",
];

export interface RedisOidcAdapterOptions {
  /**
   * Redis 连接 URL
   * 格式: redis://[:password@]host[:port][/db-number]
   * 示例: redis://localhost:6379
   */
  url?: string;

  /**
   * Redis 主机地址
   * @default 'localhost'
   */
  host?: string;

  /**
   * Redis 端口
   * @default 6379
   */
  port?: number;

  /**
   * Redis 密码
   */
  password?: string;

  /**
   * Redis 数据库编号
   * @default 0
   */
  database?: number;

  /**
   * 键前缀
   * @default 'oidc:'
   */
  keyPrefix?: string;
}

export class RedisOidcAdapter implements Adapter {
  private static client: any = null;
  private static clientPromise: Promise<any> | null = null;
  private name: string;
  private keyPrefix: string;
  private options: RedisOidcAdapterOptions;

  constructor(name: string, options: RedisOidcAdapterOptions = {}) {
    this.name = name;
    this.options = options;
    this.keyPrefix = options.keyPrefix || "oidc:";
  }

  /**
   * 初始化 Redis 客户端
   */
  private async initializeClient(options: RedisOidcAdapterOptions): Promise<any> {
    const client = createClient({
      url: options.url,
      socket: {
        host: options.host || "localhost",
        port: options.port || 6379,
      },
      password: options.password,
      database: options.database || 0,
    });

    client.on("error", (err: Error) => {
      console.error("[RedisOidcAdapter] Redis Client Error:", err);
    });

    client.on("connect", () => {
      console.log("[RedisOidcAdapter] Redis Client Connected");
    });

    await client.connect();
    RedisOidcAdapter.client = client;
    return client;
  }

  /**
   * 获取 Redis 客户端实例
   */
  private async getClient(): Promise<any> {
    if (RedisOidcAdapter.client) {
      return RedisOidcAdapter.client;
    }

    if (RedisOidcAdapter.clientPromise) {
      return await RedisOidcAdapter.clientPromise;
    }

    RedisOidcAdapter.clientPromise = this.initializeClient(this.options);
    return RedisOidcAdapter.clientPromise;
  }

  /**
   * 生成 Redis 键
   */
  private key(id: string): string {
    return `${this.keyPrefix}${this.name}:${id}`;
  }

  /**
   * 生成用户代码索引键
   */
  private userCodeKey(userCode: string): string {
    return `${this.keyPrefix}userCode:${userCode}`;
  }

  /**
   * 生成 UID 索引键
   */
  private uidKey(uid: string): string {
    return `${this.keyPrefix}uid:${uid}`;
  }

  /**
   * 生成 grantId 索引键
   */
  private grantIdKey(grantId: string): string {
    return `${this.keyPrefix}${this.name}:grantId:${grantId}`;
  }

  private accountIdKey(accountId: string): string {
    return `${this.keyPrefix}accountId:${accountId}`;
  }

  private clientIdKey(clientId: string): string {
    return `${this.keyPrefix}clientId:${clientId}`;
  }

  /**
   * 插入或更新记录
   */
  async upsert(id: string, payload: any, expiresIn?: number): Promise<void> {
    // Redis 的共享栅栏是事实源，其他实例重新启用后不能继续受本地旧状态阻塞。
    const client = await this.getClient();
    const key = this.key(id);
    const value = JSON.stringify(payload);
    const accountIds = readOidcPayloadAccountIds(payload);
    const accountId = accountIds[0];
    const clientId = readOidcPayloadClientId(payload);
    const requiresGrant = requiresOidcGrant(this.name, payload);
    if (accountIds.length > 0 || clientId) {
      const result = await client.eval(UPSERT_BOUND_RECORD_SCRIPT, {
        keys: [
          key,
          accountId ? RedisOidcAdapter.accountBlockKey(this.keyPrefix, accountId) : "",
          accountId ? RedisOidcAdapter.accountBlockLeasesKey(this.keyPrefix, accountId) : "",
          clientId ? `${this.keyPrefix}clientBlock:${clientId}` : "",
          clientId ? `${this.keyPrefix}clientBlockLeases:${clientId}` : "",
          ...accountIds
            .slice(1)
            .flatMap((id) => [
              RedisOidcAdapter.accountBlockKey(this.keyPrefix, id),
              RedisOidcAdapter.accountBlockLeasesKey(this.keyPrefix, id),
            ]),
          ...(requiresGrant ? [`${this.keyPrefix}Grant:${payload.grantId}`] : []),
        ],
        arguments: [
          this.keyPrefix,
          this.name,
          id,
          value,
          String(expiresIn ?? 0),
          String(accountIds.length),
          clientId ? "1" : "0",
          ...(requiresGrant ? ["1"] : []),
        ],
      });
      if (Number(result) === -2) throw new OidcGrantRevokedError();
      if (Number(result) === -1) {
        throw new OidcClientRevokedError();
      }
      if (Number(result) === 0) {
        throw new OidcAccountRevokedError();
      }
      if (Number(result) !== 1) {
        throw new Error("OIDC Redis write barrier operation failed");
      }
      return;
    }
    const previousPayload = await this.find(id);

    await this.removeStaleIndexes(client, id, previousPayload, payload);

    // 设置主键值
    if (expiresIn) {
      await client.setEx(key, expiresIn, value);
    } else {
      await client.set(key, value);
    }

    // 创建索引
    if (payload.userCode) {
      const userCodeKey = this.userCodeKey(payload.userCode);
      if (expiresIn) {
        await client.setEx(userCodeKey, expiresIn, id);
      } else {
        await client.set(userCodeKey, id);
      }
    }

    if (payload.uid) {
      const uidKey = this.uidKey(payload.uid);
      if (expiresIn) {
        await client.setEx(uidKey, expiresIn, id);
      } else {
        await client.set(uidKey, id);
      }
    }

    if (payload.grantId) {
      const grantIdKey = this.grantIdKey(payload.grantId);
      await this.addExpiringSetMember(client, grantIdKey, id, expiresIn);
    }
  }

  /**
   * 查找记录
   */
  async find(id: string): Promise<any> {
    const client = await this.getClient();
    const key = this.key(id);
    const value = await client.get(key);

    if (!value) {
      return undefined;
    }

    try {
      return JSON.parse(value);
    } catch (err) {
      console.error("[RedisOidcAdapter] JSON parse error:", err);
      return undefined;
    }
  }

  /**
   * 通过用户代码查找
   */
  async findByUserCode(userCode: string): Promise<any> {
    const client = await this.getClient();
    const userCodeKey = this.userCodeKey(userCode);
    const id = await client.get(userCodeKey);

    if (!id) {
      return undefined;
    }

    return this.find(id);
  }

  /**
   * 通过 UID 查找
   */
  async findByUid(uid: string): Promise<any> {
    const client = await this.getClient();
    const uidKey = this.uidKey(uid);
    const id = await client.get(uidKey);

    if (!id) {
      return undefined;
    }

    return this.find(id);
  }

  /**
   * 消费记录（标记为已使用）
   */
  async consume(id: string): Promise<void> {
    const client = await this.getClient();
    const key = this.key(id);
    const result = await client.eval(
      [
        "local value = redis.call('GET', KEYS[1])",
        "if not value then return 0 end",
        "local payload = cjson.decode(value)",
        "if payload.consumed then return -1 end",
        "local ttl = redis.call('TTL', KEYS[1])",
        "if ttl == -2 then return 0 end",
        "payload.consumed = tonumber(ARGV[1])",
        "if ttl > 0 then",
        "  redis.call('SETEX', KEYS[1], ttl, cjson.encode(payload))",
        "else",
        "  redis.call('SET', KEYS[1], cjson.encode(payload))",
        "end",
        "return 1",
      ].join("\n"),
      { keys: [key], arguments: [String(Math.floor(Date.now() / 1000))] },
    );

    if (Number(result) === -1) {
      throw new Error(`OIDC ${this.name} record has already been consumed`);
    }
    if (Number(result) === 0) {
      return;
    }
    if (Number(result) !== 1) {
      throw new Error(`OIDC ${this.name} consume operation failed`);
    }
  }

  /**
   * 删除记录
   */
  async destroy(id: string): Promise<void> {
    const client = await this.getClient();

    // 获取 payload 以清理索引
    const payload = await this.find(id);

    // 删除主键
    const key = this.key(id);
    await client.del(key);

    // 清理索引
    if (payload) {
      if (payload.userCode) {
        await this.deleteIndexIfPointsTo(client, this.userCodeKey(payload.userCode), id);
      }
      if (payload.uid) {
        await this.deleteIndexIfPointsTo(client, this.uidKey(payload.uid), id);
      }
      if (payload.grantId) {
        const grantIdKey = this.grantIdKey(payload.grantId);
        await client.sRem(grantIdKey, id);
      }
      for (const accountId of readOidcPayloadAccountIds(payload)) {
        await client.sRem(this.accountIdKey(accountId), `${this.name}:${id}`);
      }
      const clientId = readOidcPayloadClientId(payload);
      if (clientId) {
        await client.sRem(this.clientIdKey(clientId), `${this.name}:${id}`);
      }
    }
  }

  /**
   * 通过 grantId 撤销所有相关记录
   */
  async revokeByGrantId(grantId: string): Promise<void> {
    const client = await this.getClient();
    const grantIdKey = this.grantIdKey(grantId);

    // 获取所有关联的 ID
    const ids = await client.sMembers(grantIdKey);

    if (ids.length === 0) {
      return;
    }

    // 删除所有关联的记录
    const pipeline = client.multi();

    for (const id of ids) {
      pipeline.del(this.key(id));
    }

    // 删除 grantId 索引
    pipeline.del(grantIdKey);

    await pipeline.exec();
  }

  /**
   * 删除账户所属的所有 OIDC 模型记录。账户索引使用 `model:id` 成员，避免不同
   * adapter 模型之间同名 id 互相误删。
   */
  static async acquireAccountBlock(
    accountId: string,
    options: RedisOidcAdapterOptions | undefined,
  ): Promise<OidcAccountBlockLease> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    const keyPrefix = options?.keyPrefix || "oidc:";
    const leaseKey = RedisOidcAdapter.accountBlockLeasesKey(keyPrefix, accountId);
    const durableKey = RedisOidcAdapter.accountBlockKey(keyPrefix, accountId);
    return { accountId, ...(await RedisOidcAdapter.acquireBlock(client, durableKey, leaseKey)) };
  }

  static async acquireClientBlock(
    clientId: string,
    options: RedisOidcAdapterOptions | undefined,
  ): Promise<OidcClientBlockLease> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    const prefix = options?.keyPrefix || "oidc:";
    return {
      clientId,
      ...(await RedisOidcAdapter.acquireBlock(
        client,
        `${prefix}clientBlock:${clientId}`,
        `${prefix}clientBlockLeases:${clientId}`,
      )),
    };
  }

  private static async acquireBlock(
    client: any,
    durableKey: string,
    leaseKey: string,
  ): Promise<Pick<OidcClientBlockLease, "commit" | "release">> {
    const token = randomBytes(32).toString("hex");
    await client.eval(
      [
        "redis.call('SADD', KEYS[1], ARGV[1])",
        "redis.call('EXPIRE', KEYS[1], ARGV[2])",
        "return 1",
      ].join("\n"),
      {
        keys: [leaseKey],
        arguments: [token, String(BLOCK_LEASE_TTL_SECONDS)],
      },
    );

    let settled = false;
    return Object.freeze({
      async commit(): Promise<void> {
        if (settled) return;
        await client.eval(
          [
            "redis.call('SET', KEYS[1], '1')",
            "redis.call('SREM', KEYS[2], ARGV[1])",
            "if redis.call('SCARD', KEYS[2]) == 0 then redis.call('DEL', KEYS[2]) end",
            "return 1",
          ].join("\n"),
          { keys: [durableKey, leaseKey], arguments: [token] },
        );
        settled = true;
      },
      async release(): Promise<void> {
        if (settled) return;
        await client.eval(
          [
            "redis.call('SREM', KEYS[1], ARGV[1])",
            "if redis.call('SCARD', KEYS[1]) == 0 then redis.call('DEL', KEYS[1]) end",
            "return 1",
          ].join("\n"),
          { keys: [leaseKey], arguments: [token] },
        );
        settled = true;
      },
    });
  }

  static async revokeByAccountId(
    accountId: string,
    options: RedisOidcAdapterOptions | undefined,
  ): Promise<void> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    const keyPrefix = options?.keyPrefix || "oidc:";
    const accountKey = `${keyPrefix}accountId:${accountId}`;
    await client.eval(
      [
        ...DELETE_ACCOUNT_RECORD_LUA,
        "if redis.call('EXISTS', KEYS[2]) == 0 and redis.call('EXISTS', KEYS[3]) == 0 then",
        "  redis.call('SET', KEYS[2], '1')",
        "end",
        "local members = redis.call('SMEMBERS', KEYS[1])",
        "for _, member in ipairs(members) do",
        "  local separator = string.find(member, ':', 1, true)",
        "  if separator then deleteAccountRecord(ARGV[1], ARGV[1] .. member, string.sub(member, 1, separator - 1), string.sub(member, separator + 1), ARGV[2]) end",
        "end",
        "redis.call('DEL', KEYS[1])",
        "return #members",
      ].join("\n"),
      {
        keys: [
          accountKey,
          RedisOidcAdapter.accountBlockKey(keyPrefix, accountId),
          RedisOidcAdapter.accountBlockLeasesKey(keyPrefix, accountId),
        ],
        arguments: [keyPrefix, accountId],
      },
    );

    // 老版本 Interaction 只含嵌套 accountId，未进入 accountId 索引。
    // 保持账户栅栏时增量扫描；每条删除都在 Lua 内重新检查当前关联，避免误删并发改写。
    const interactionPrefix = `${keyPrefix}Interaction:`;
    const pattern = `${interactionPrefix.replace(/[\\*?[\]]/gu, "\\$&")}*`;
    const deleteScript = [
      ...DELETE_ACCOUNT_RECORD_LUA,
      "return deleteAccountRecord(ARGV[1], KEYS[1], 'Interaction', ARGV[2], ARGV[3])",
    ].join("\n");
    for await (const batch of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      const keys: string[] = Array.isArray(batch) ? batch : [batch];
      for (let offset = 0; offset < keys.length; offset += 100) {
        await Promise.all(
          keys.slice(offset, offset + 100).map((key) =>
            client.eval(deleteScript, {
              keys: [key],
              arguments: [keyPrefix, key.slice(interactionPrefix.length), accountId],
            }),
          ),
        );
      }
    }
  }

  static async allowAccountId(
    accountId: string,
    options: RedisOidcAdapterOptions | undefined,
  ): Promise<void> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    const keyPrefix = options?.keyPrefix || "oidc:";
    await client.del(RedisOidcAdapter.accountBlockKey(keyPrefix, accountId));
  }

  /** 删除指定 Client 的全部 OIDC 模型记录。 */
  static async revokeByClientId(
    clientId: string,
    options: RedisOidcAdapterOptions | undefined,
  ): Promise<void> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    const keyPrefix = options?.keyPrefix || "oidc:";
    await client.eval(
      [
        "redis.call('SET', KEYS[2], '1')",
        "local members = redis.call('SMEMBERS', KEYS[1])",
        "for _, member in ipairs(members) do",
        "  if string.find(member, ':', 1, true) then redis.call('DEL', ARGV[1] .. member) end",
        "end",
        "redis.call('DEL', KEYS[1])",
        "return #members",
      ].join("\n"),
      {
        keys: [`${keyPrefix}clientId:${clientId}`, `${keyPrefix}clientBlock:${clientId}`],
        arguments: [keyPrefix],
      },
    );
  }

  static async allowClientId(clientId: string, options?: RedisOidcAdapterOptions): Promise<void> {
    const client = await RedisOidcAdapter.getSharedClient(options);
    await client.del(`${options?.keyPrefix || "oidc:"}clientBlock:${clientId}`);
  }

  /**
   * 关闭 Redis 连接
   * 注意: 这会关闭所有适配器共享的连接
   */
  static async disconnect(): Promise<void> {
    const client =
      RedisOidcAdapter.client ?? (await RedisOidcAdapter.clientPromise?.catch(() => null));
    try {
      if (client) {
        await client.quit();
        console.log("[RedisOidcAdapter] Redis Client Disconnected");
      }
    } finally {
      RedisOidcAdapter.client = null;
      RedisOidcAdapter.clientPromise = null;
    }
  }

  private async addExpiringSetMember(
    client: any,
    key: string,
    member: string,
    expiresIn?: number,
  ): Promise<void> {
    if (expiresIn === undefined || expiresIn <= 0) {
      await client.sAdd(key, member);
      return;
    }

    // TTL、成员写入和 TTL 扩展必须在 Redis 内原子执行，避免并发的短期记录
    // 在长期记录之后执行 EXPIRE，导致撤销索引提前消失。
    await client.eval(
      [
        "local previousTtl = redis.call('TTL', KEYS[1])",
        "redis.call('SADD', KEYS[1], ARGV[1])",
        "local requestedTtl = tonumber(ARGV[2])",
        "if previousTtl == -2 or (previousTtl >= 0 and previousTtl < requestedTtl) then",
        "  redis.call('EXPIRE', KEYS[1], requestedTtl)",
        "end",
        "return 1",
      ].join("\n"),
      {
        keys: [key],
        arguments: [member, String(Math.max(1, Math.floor(expiresIn)))],
      },
    );
  }

  private async deleteIndexIfPointsTo(client: any, key: string, id: string): Promise<void> {
    if ((await client.get(key)) === id) {
      await client.del(key);
    }
  }

  private async removeStaleIndexes(
    client: any,
    id: string,
    previousPayload: any,
    nextPayload: any,
  ): Promise<void> {
    if (!previousPayload) {
      return;
    }

    if (previousPayload.userCode && previousPayload.userCode !== nextPayload.userCode) {
      await this.deleteIndexIfPointsTo(client, this.userCodeKey(previousPayload.userCode), id);
    }
    if (previousPayload.uid && previousPayload.uid !== nextPayload.uid) {
      await this.deleteIndexIfPointsTo(client, this.uidKey(previousPayload.uid), id);
    }
    if (previousPayload.grantId && previousPayload.grantId !== nextPayload.grantId) {
      await client.sRem(this.grantIdKey(previousPayload.grantId), id);
    }
    const nextAccounts = new Set(readOidcPayloadAccountIds(nextPayload));
    for (const accountId of readOidcPayloadAccountIds(previousPayload)) {
      if (!nextAccounts.has(accountId)) {
        await client.sRem(this.accountIdKey(accountId), `${this.name}:${id}`);
      }
    }
    const previousClientId = readOidcPayloadClientId(previousPayload);
    const nextClientId = readOidcPayloadClientId(nextPayload);
    if (previousClientId && previousClientId !== nextClientId) {
      await client.sRem(this.clientIdKey(previousClientId), `${this.name}:${id}`);
    }
  }

  private static async getSharedClient(options?: RedisOidcAdapterOptions): Promise<any> {
    if (RedisOidcAdapter.client) {
      return RedisOidcAdapter.client;
    }
    if (!RedisOidcAdapter.clientPromise) {
      const bootstrap = new RedisOidcAdapter("bootstrap", options ?? {});
      return bootstrap.getClient();
    }
    return RedisOidcAdapter.clientPromise;
  }

  private static accountBlockKey(keyPrefix: string, accountId: string): string {
    return `${keyPrefix}accountBlock:${accountId}`;
  }

  private static accountBlockLeasesKey(keyPrefix: string, accountId: string): string {
    return `${keyPrefix}accountBlockLeases:${accountId}`;
  }
}
