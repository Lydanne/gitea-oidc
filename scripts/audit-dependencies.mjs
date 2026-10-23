import { spawnSync } from "node:child_process";

const productionOnly = process.argv.includes("--prod");
const dependencyFields = productionOnly
  ? ["dependencies", "optionalDependencies"]
  : ["dependencies", "devDependencies", "optionalDependencies"];

const runPnpm = (args) => {
  const pnpmCli = process.env.npm_execpath;
  const result = pnpmCli
    ? spawnSync(process.execPath, [pnpmCli, ...args], {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      })
    : spawnSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n");
    throw new Error(`pnpm ${args.join(" ")} 执行失败${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
};

const packageVersions = new Map();
const collectDependencies = (node) => {
  for (const field of dependencyFields) {
    const dependencies = node[field];
    if (!dependencies || typeof dependencies !== "object") continue;
    for (const [alias, dependency] of Object.entries(dependencies)) {
      if (!dependency || typeof dependency !== "object") continue;
      const name = typeof dependency.from === "string" ? dependency.from : alias;
      const version = dependency.version;
      if (
        typeof version === "string" &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(version)
      ) {
        const versions = packageVersions.get(name) ?? new Set();
        versions.add(version);
        packageVersions.set(name, versions);
      }
      collectDependencies(dependency);
    }
  }
};

const projects = JSON.parse(
  runPnpm([
    "list",
    "--recursive",
    "--json",
    "--depth",
    "Infinity",
    ...(productionOnly ? ["--prod"] : []),
  ]),
);
for (const project of projects) collectDependencies(project);

const auditPayload = Object.fromEntries(
  [...packageVersions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, versions]) => [name, [...versions].sort()]),
);
if (Object.keys(auditPayload).length === 0) {
  throw new Error("未从 pnpm 依赖树中发现可审计的 registry package");
}

const registry = new URL(process.env.npm_config_registry ?? "https://registry.npmjs.org/");
const auditUrl = new URL("-/npm/v1/security/advisories/bulk", registry);
const response = await fetch(auditUrl, {
  method: "POST",
  signal: AbortSignal.timeout(30_000),
  headers: {
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify(auditPayload),
});
if (!response.ok) {
  const details = (await response.text()).slice(0, 500);
  throw new Error(`依赖审计接口请求失败: HTTP ${response.status}${details ? `\n${details}` : ""}`);
}

const result = await response.json();
if (!result || typeof result !== "object" || Array.isArray(result)) {
  throw new Error("依赖审计接口返回了无效结果");
}

const advisories = [];
for (const [packageName, packageAdvisories] of Object.entries(result)) {
  if (!Array.isArray(packageAdvisories)) {
    throw new Error(`依赖审计接口返回了无效的 ${packageName} 公告列表`);
  }
  for (const advisory of packageAdvisories) {
    if (!advisory || typeof advisory !== "object" || Array.isArray(advisory)) {
      throw new Error(`依赖审计接口返回了无效的 ${packageName} 公告`);
    }
    advisories.push({ packageName, ...advisory });
  }
}
if (advisories.length > 0) {
  const severityOrder = { critical: 0, high: 1, moderate: 2, low: 3, info: 4 };
  advisories.sort(
    (left, right) =>
      (severityOrder[left.severity] ?? 5) - (severityOrder[right.severity] ?? 5) ||
      left.packageName.localeCompare(right.packageName),
  );
  for (const advisory of advisories) {
    const versions = auditPayload[advisory.packageName]?.join(", ") ?? "unknown";
    console.error(
      `[${advisory.severity ?? "unknown"}] ${advisory.packageName}@${versions}: ${advisory.title ?? "未命名安全公告"}`,
    );
    console.error(`  影响范围: ${advisory.vulnerable_versions ?? "unknown"}`);
    if (advisory.url) console.error(`  ${advisory.url}`);
  }
  throw new Error(`依赖审计发现 ${advisories.length} 条安全公告`);
}

console.log(
  `依赖审计通过，共检查 ${Object.values(auditPayload).reduce((total, versions) => total + versions.length, 0)} 个 package version`,
);
