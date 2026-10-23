import { existsSync, writeFileSync } from "node:fs";

const requiredEnvironment = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`缺少测试环境变量 ${name}`);
  return value;
};

const dbPath = requiredEnvironment("SQLITE_TEST_DB_PATH");
const barrierDirectory = requiredEnvironment("SQLITE_TEST_BARRIER_DIRECTORY");
const workerId = requiredEnvironment("SQLITE_TEST_WORKER_ID");
const moduleUrl = requiredEnvironment("SQLITE_TEST_MODULE_URL");
const ownerNamespace = requiredEnvironment("SQLITE_TEST_OWNER_NAMESPACE");
const rounds = Number.parseInt(requiredEnvironment("SQLITE_TEST_ROUNDS"), 10);
if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error("测试轮次无效");

const { createSqliteOidcStores } = await import(moduleUrl);
const stores = createSqliteOidcStores({
  dbPath,
  encryptionKey: Buffer.alloc(32, 7),
  busyTimeoutMs: 5_000,
});

try {
  for (let index = 0; index < rounds; index += 1) {
    const readyPath = `${barrierDirectory}/${workerId}-ready-${index}`;
    const goPath = `${barrierDirectory}/go-${index}`;
    writeFileSync(readyPath, "");
    while (!existsSync(goPath)) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    const transactionId = String(index).padStart(43, "t");
    try {
      const value = await stores.transactionStore.consume(ownerNamespace, transactionId);
      console.log(JSON.stringify({ index, outcome: value ? "value" : "null" }));
    } catch (error) {
      console.log(
        JSON.stringify({
          index,
          outcome: "error",
          code:
            typeof error === "object" && error !== null && "code" in error
              ? String(error.code)
              : "UNKNOWN",
        }),
      );
    }
  }
} finally {
  await stores.close();
}
