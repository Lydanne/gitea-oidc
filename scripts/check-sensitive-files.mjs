import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

import {
  findSuspiciousAssignments,
  isExplicitFixture,
} from "./release/sensitive-value-detection.mjs";

const HIGH_CONFIDENCE_PATTERNS = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{40,255})\b/u],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,255}\b/u],
  [
    "cloud-access-key",
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bLTAI[A-Za-z0-9]{16,24}\b|\bAKID[A-Za-z0-9]{13,40}\b/u,
  ],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u],
  [
    "credential-url",
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:[\]]+:[^\s/@[\]]+@/iu,
  ],
  ["npmrc-auth", /(?:^|\s)_authToken\s*=\s*(?!\$\{)[^\s#]{8,}/iu],
];
const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  },
)
  .split("\0")
  .filter(Boolean);

const forbiddenPathRules = [
  ["dotenv", /(^|\/)\.env(?:\..+)?$/u],
  ["password-file", /(^|\/)\.htpasswd$/u],
  ["runtime-jwks", /(^|\/)jwks(?:\.[^.]+)?\.json$/iu],
  ["private-key", /\.(?:key|pem|p12|pfx|rsa)$/iu],
  ["runtime-database", /\.(?:db|sqlite|sqlite3)(?:-(?:journal|shm|wal))?$/iu],
  ["gitea-runtime-config", /^gitea-server\/config\/app\.ini$/u],
];
const allowedPaths = new Set([".env.example", "example.htpasswd"]);
const findings = [];

for (const file of trackedFiles) {
  const metadata = await stat(file).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (!metadata) continue;

  if (!allowedPaths.has(file)) {
    for (const [rule, pattern] of forbiddenPathRules) {
      if (pattern.test(file)) findings.push({ file, line: 1, rule });
    }
  }

  if (!metadata.isFile() || metadata.size > 5 * 1024 * 1024) continue;
  const buffer = await readFile(file);
  if (buffer.includes(0)) continue;
  const lines = buffer.toString("utf8").split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    for (const [rule, pattern] of HIGH_CONFIDENCE_PATTERNS) {
      const match = pattern.exec(line);
      if (match && !isExplicitFixture(match[0])) {
        findings.push({ file, line: index + 1, rule });
      }
    }
  }
  if (isDocumentationOrConfig(file)) {
    for (const finding of findSuspiciousAssignments(lines)) findings.push({ file, ...finding });
  }
}

const unique = [
  ...new Map(
    findings.map((finding) => [`${finding.file}:${finding.line}:${finding.rule}`, finding]),
  ).values(),
];
if (unique.length > 0) {
  for (const finding of unique) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}] 疑似敏感内容`);
  }
  throw new Error(`敏感文件检查失败，共 ${unique.length} 项；输出已隐藏原值`);
}

console.log(`敏感文件检查通过，共检查 ${trackedFiles.length} 个待提交或已跟踪文件`);

function isDocumentationOrConfig(file) {
  return (
    file === "README.md" ||
    file === "README.en.md" ||
    file.startsWith("docs/") ||
    file.startsWith("gitea-server/") ||
    /(?:^|\/)(?:example\.)?[^/]*config[^/]*\.(?:js|json|ts)$/iu.test(file)
  );
}
