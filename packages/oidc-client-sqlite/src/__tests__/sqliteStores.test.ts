import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoginTransaction, SensitiveAuthSessionRecord } from "@gitea-oidc/node";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteOidcStores } from "../index.js";

const OWNER = `owner-v1:${"o".repeat(43)}`;
const TRANSACTION_ID = "t".repeat(43);
const SESSION_ID = "s".repeat(43);
const NOW = Date.now();

const transaction: LoginTransaction = {
  ownerNamespace: OWNER,
  transactionId: TRANSACTION_ID,
  state: "a".repeat(43),
  nonce: "n".repeat(43),
  codeVerifier: "v".repeat(43),
  redirectUri: "https://app.example.com/oidc/callback",
  returnTo: "/dashboard",
  scopes: ["openid", "profile"],
  resources: [],
  createdAt: NOW,
  expiresAt: NOW + 10 * 60_000,
};

const session: SensitiveAuthSessionRecord = {
  ownerNamespace: OWNER,
  sessionId: SESSION_ID,
  subject: "user-1",
  user: {
    subject: "user-1",
    name: "示例用户",
    groups: ["developers"],
  },
  scopes: ["openid", "profile"],
  resources: [],
  tokens: {
    accessToken: "access-token-must-be-encrypted",
    tokenType: "Bearer",
    refreshToken: "refresh-token-must-be-encrypted",
    idToken: "id-token-must-be-encrypted",
  },
  refreshVersion: 0,
  createdAt: NOW,
  updatedAt: NOW,
  expiresAt: NOW + 8 * 60 * 60_000,
};

const directories: string[] = [];
const storesToClose: Array<ReturnType<typeof createSqliteOidcStores>> = [];

const createDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "gitea-oidc-node-sqlite-"));
  directories.push(directory);
  return join(directory, "sessions.db");
};

const createStores = (dbPath: string, key: Uint8Array = Buffer.alloc(32, 7)) => {
  const stores = createSqliteOidcStores({
    dbPath,
    encryptionKey: key,
    lockLeaseMs: 1_000,
    lockPollIntervalMs: 10,
  });
  storesToClose.push(stores);
  return stores;
};

const startConsumeWorker = (environment: NodeJS.ProcessEnv) => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", join(import.meta.dirname, "fixtures", "consumeWorker.mjs")],
    {
      cwd: join(import.meta.dirname, "..", ".."),
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const completion = new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve) => {
      child.once("error", (error) => {
        resolve({ code: null, stdout, stderr: `${stderr}${error.message}` });
      });
      child.once("close", (code) => {
        resolve({ code, stdout, stderr });
      });
    },
  );
  return {
    child,
    completion,
    readStderr: () => stderr,
  };
};

afterEach(async () => {
  await Promise.allSettled(storesToClose.splice(0).map((stores) => stores.close()));
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SQLite Node OIDC stores", () => {
  it("atomically creates and consumes an encrypted transaction once", async () => {
    const dbPath = createDatabasePath();
    const stores = createStores(dbPath);

    await expect(stores.transactionStore.create(transaction)).resolves.toBe(true);
    await expect(stores.transactionStore.create(transaction)).resolves.toBe(false);
    await expect(
      stores.transactionStore.consume(`owner-v1:${"x".repeat(43)}`, TRANSACTION_ID),
    ).resolves.toBeNull();
    await expect(stores.transactionStore.consume(OWNER, TRANSACTION_ID)).resolves.toEqual(
      transaction,
    );
    await expect(stores.transactionStore.consume(OWNER, TRANSACTION_ID)).resolves.toBeNull();

    const databaseBytes = readFileSync(dbPath);
    expect(databaseBytes.includes(Buffer.from(transaction.codeVerifier))).toBe(false);
    expect(databaseBytes.includes(Buffer.from(transaction.state))).toBe(false);
  });

  it("returns one value and one null under repeated cross-process transaction consumption", async () => {
    const rounds = 30;
    const dbPath = createDatabasePath();
    const stores = createStores(dbPath);
    for (let index = 0; index < rounds; index += 1) {
      await expect(
        stores.transactionStore.create({
          ...transaction,
          transactionId: String(index).padStart(43, "t"),
        }),
      ).resolves.toBe(true);
    }

    const barrierDirectory = dirname(dbPath);
    const baseEnvironment = {
      SQLITE_TEST_DB_PATH: dbPath,
      SQLITE_TEST_BARRIER_DIRECTORY: barrierDirectory,
      SQLITE_TEST_MODULE_URL: pathToFileURL(join(import.meta.dirname, "..", "index.ts")).href,
      SQLITE_TEST_OWNER_NAMESPACE: OWNER,
      SQLITE_TEST_ROUNDS: String(rounds),
    };
    const workers = [
      startConsumeWorker({ ...baseEnvironment, SQLITE_TEST_WORKER_ID: "first" }),
      startConsumeWorker({ ...baseEnvironment, SQLITE_TEST_WORKER_ID: "second" }),
    ];

    try {
      for (let index = 0; index < rounds; index += 1) {
        const readyPaths = workers.map((_, workerIndex) =>
          join(barrierDirectory, `${workerIndex === 0 ? "first" : "second"}-ready-${index}`),
        );
        let ready = false;
        for (let attempt = 0; attempt < 5_000; attempt += 1) {
          if (readyPaths.every((path) => existsSync(path))) {
            ready = true;
            break;
          }
          if (workers.some(({ child }) => child.exitCode !== null)) break;
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        if (!ready) {
          throw new Error(
            `消费 worker 未就绪: ${workers.map((worker) => worker.readStderr()).join(" ")}`,
          );
        }
        writeFileSync(join(barrierDirectory, `go-${index}`), "");
      }

      const completed = await Promise.all(workers.map((worker) => worker.completion));
      for (const result of completed) {
        expect(result.code, result.stderr).toBe(0);
      }
      const outcomes = completed.flatMap((result) =>
        result.stdout
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) => JSON.parse(line) as { index: number; outcome: "error" | "null" | "value" },
          ),
      );
      expect(outcomes).toHaveLength(rounds * 2);
      for (let index = 0; index < rounds; index += 1) {
        expect(
          outcomes
            .filter((outcome) => outcome.index === index)
            .map((outcome) => outcome.outcome)
            .sort(),
        ).toEqual(["null", "value"]);
      }
    } finally {
      for (const { child } of workers) {
        if (child.exitCode === null) child.kill();
      }
      await Promise.all(workers.map((worker) => worker.completion));
    }
  }, 15_000);

  it("stores only domain-separated HMAC lookup keys for opaque identifiers", async () => {
    const dbPath = createDatabasePath();
    const stores = createStores(dbPath);
    await stores.transactionStore.create(transaction);
    await stores.sessionStore.create(session);
    let entered!: () => void;
    let release!: () => void;
    const lockEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockOperation = stores.refreshLock.runExclusive(OWNER, SESSION_ID, async () => {
      entered();
      await gate;
    });
    await lockEntered;

    try {
      const database = new Database(dbPath, { readonly: true });
      const transactionRow = database
        .prepare("SELECT transaction_id FROM node_oidc_transactions")
        .get() as { transaction_id: string };
      const sessionRow = database.prepare("SELECT session_id FROM node_oidc_sessions").get() as {
        session_id: string;
      };
      const lockRow = database.prepare("SELECT session_id FROM node_oidc_refresh_locks").get() as {
        session_id: string;
      };
      database.close();

      expect(transactionRow.transaction_id).not.toBe(TRANSACTION_ID);
      expect(sessionRow.session_id).not.toBe(SESSION_ID);
      expect(lockRow.session_id).not.toBe(SESSION_ID);
      expect(sessionRow.session_id).not.toBe(lockRow.session_id);
      expect(transactionRow.transaction_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(sessionRow.session_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(lockRow.session_id).toMatch(/^[A-Za-z0-9_-]{43}$/u);

      const databaseDirectory = dirname(dbPath);
      for (const filename of readdirSync(databaseDirectory)) {
        const bytes = readFileSync(join(databaseDirectory, filename));
        expect(bytes.includes(Buffer.from(TRANSACTION_ID))).toBe(false);
        expect(bytes.includes(Buffer.from(SESSION_ID))).toBe(false);
      }
    } finally {
      release();
      await lockOperation;
    }
  });

  it("persists encrypted sessions and enforces CAS plus versioned delete", async () => {
    const dbPath = createDatabasePath();
    const first = createStores(dbPath);
    await expect(first.sessionStore.create(session)).resolves.toBe(true);
    await first.close();

    const second = createStores(dbPath);
    await expect(second.sessionStore.get(OWNER, SESSION_ID)).resolves.toEqual(session);
    const refreshed: SensitiveAuthSessionRecord = {
      ...session,
      tokens: {
        ...session.tokens,
        accessToken: "rotated-access-token",
        refreshToken: "rotated-refresh-token",
      },
      refreshVersion: 1,
      updatedAt: NOW + 1_000,
    };
    await expect(
      second.sessionStore.compareAndSwap(OWNER, SESSION_ID, 1, {
        ...refreshed,
        refreshVersion: 2,
      }),
    ).resolves.toBe(false);
    await expect(second.sessionStore.compareAndSwap(OWNER, SESSION_ID, 0, refreshed)).resolves.toBe(
      true,
    );
    await expect(second.sessionStore.deleteIfVersion(OWNER, SESSION_ID, 0)).resolves.toBe(false);
    await expect(second.sessionStore.deleteIfVersion(OWNER, SESSION_ID, 1)).resolves.toBe(true);
    await expect(second.sessionStore.get(OWNER, SESSION_ID)).resolves.toBeNull();

    const databaseBytes = readFileSync(dbPath);
    expect(databaseBytes.includes(Buffer.from("refresh-token-must-be-encrypted"))).toBe(false);
    expect(databaseBytes.includes(Buffer.from("rotated-refresh-token"))).toBe(false);
  });

  it("fails closed on ciphertext metadata tampering", async () => {
    const dbPath = createDatabasePath();
    const first = createStores(dbPath);
    await first.sessionStore.create(session);

    const database = new Database(dbPath);
    database
      .prepare(
        `UPDATE node_oidc_sessions
         SET auth_tag = ?
         WHERE owner_namespace = ?`,
      )
      .run(Buffer.alloc(16, 9), OWNER);
    database.close();
    await expect(first.sessionStore.get(OWNER, SESSION_ID)).rejects.toMatchObject({
      code: "CORRUPTED_DATA",
    });
  });

  it("fails closed when reopened with a different encryption key", async () => {
    const dbPath = createDatabasePath();
    const first = createStores(dbPath);
    await first.sessionStore.create(session);
    await first.close();

    expect(() => createStores(dbPath, Buffer.alloc(32, 8))).toThrowError(
      expect.objectContaining({ code: "CORRUPTED_DATA" }),
    );
  });

  it("serializes refresh work across two SQLite connections", async () => {
    const dbPath = createDatabasePath();
    const first = createStores(dbPath);
    const second = createStores(dbPath);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstOperation = first.refreshLock.runExclusive(OWNER, SESSION_ID, async () => {
      order.push("first:start");
      await firstGate;
      order.push("first:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondOperation = second.refreshLock.runExclusive(OWNER, SESSION_ID, async () => {
      order.push("second:start");
      order.push("second:end");
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(order).toEqual(["first:start"]);

    releaseFirst();
    await Promise.all([firstOperation, secondOperation]);
    expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("close waits for in-flight lock work, is idempotent and rejects later access", async () => {
    const dbPath = createDatabasePath();
    const stores = createStores(dbPath);
    await stores.sessionStore.create(session);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = stores.refreshLock.runExclusive(OWNER, SESSION_ID, async () => {
      await gate;
      const current = await stores.sessionStore.get(OWNER, SESSION_ID);
      if (!current) throw new Error("测试会话不存在");
      return stores.sessionStore.compareAndSwap(OWNER, SESSION_ID, current.refreshVersion, {
        ...current,
        refreshVersion: current.refreshVersion + 1,
        updatedAt: current.updatedAt + 1,
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    let closed = false;
    const firstClose = stores.close().then(() => {
      closed = true;
    });
    const secondClose = stores.close();
    await expect(stores.sessionStore.get(OWNER, SESSION_ID)).rejects.toMatchObject({
      code: "CLOSED",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    release();
    await expect(operation).resolves.toBe(true);
    await Promise.all([firstClose, secondClose]);
    await expect(stores.sessionStore.get(OWNER, SESSION_ID)).rejects.toMatchObject({
      code: "CLOSED",
    });

    const reopened = createStores(dbPath);
    await expect(reopened.sessionStore.get(OWNER, SESSION_ID)).resolves.toMatchObject({
      refreshVersion: 1,
    });
  });

  it("rejects close from inside a refresh callback instead of waiting on itself", async () => {
    const stores = createStores(createDatabasePath());
    await expect(
      stores.refreshLock.runExclusive(OWNER, SESSION_ID, async () => {
        const closeOutcome = await Promise.race([
          stores.close().then(
            () => "resolved",
            (error: unknown) =>
              typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
                : "unknown-error",
          ),
          new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100)),
        ]);
        expect(closeOutcome).toBe("STORAGE_FAILED");
      }),
    ).resolves.toBeUndefined();
    await expect(stores.sessionStore.get(OWNER, SESSION_ID)).resolves.toBeNull();
  });

  it("uses owner-only database permissions and rejects unsafe configuration", async () => {
    const dbPath = createDatabasePath();
    const stores = createStores(dbPath);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    await stores.close();

    expect(() =>
      createSqliteOidcStores({ dbPath: createDatabasePath(), encryptionKey: Buffer.alloc(31) }),
    ).toThrow("配置无效");
  });
});
