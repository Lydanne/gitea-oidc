const SECRET_ASSIGNMENT_PATTERN =
  /^\s*["']?(?:appSecret|app_secret|clientSecret|client_secret|cookieKeys?|encryptKey|encryptionKey|internalToken|jwtSecret|masterKey|password|tokenEncryptionKey|verificationToken)["']?\s*[:=]\s*(.*?)\s*$/iu;

export function findSuspiciousAssignments(lines) {
  const findings = [];
  let sensitiveArray = false;

  for (const [index, line] of lines.entries()) {
    const assignment = line.match(SECRET_ASSIGNMENT_PATTERN);
    if (assignment) {
      const assignedValue = assignment[1];
      if (isSuspiciousLiteral(assignedValue)) {
        findings.push({ line: index + 1, rule: "hardcoded-secret-field" });
      }
      if (assignedValue.trim().startsWith("[")) sensitiveArray = true;
    }
    if (sensitiveArray) {
      for (const value of extractStringLiterals(line)) {
        if (isSuspiciousLiteral(value)) {
          findings.push({ line: index + 1, rule: "hardcoded-secret-array" });
        }
      }
      if (line.includes("]")) sensitiveArray = false;
    }
  }

  return findings;
}

export function isExplicitFixture(value) {
  return /change[-_ ]?(?:this|me|in[-_ ]?production)|replace[-_ ]?with|your[-_ ]|example|placeholder|dummy|fake|fixture|test[-_ ]?(?:secret|token|key)|strong[-_ ]?password|user:pass|username:password|at[-_ ]?least[-_ ]?\d+[-_ ]?(?:chars?|bytes?)|(?:client|portal|admin)[-_ ]secret|x{3,}|process\.env|import\.meta\.env|\$\{|localhost|127\.0\.0\.1|<[^>]+>/iu.test(
    value,
  );
}

export function isSuspiciousLiteral(raw) {
  const value = raw
    .trim()
    .replace(/[,;]$/u, "")
    .replace(/^["'`]|["'`]$/gu, "");
  if (!value || isExplicitFixture(value)) return false;
  if (/^[A-Z][A-Z\d_]+$/u.test(value)) return false;
  if (/^(?:true|false|null|undefined|\d+)$/iu.test(value)) return false;
  if (/^(?:process\.env|import\.meta\.env|requiredEnv\(|env\()/u.test(value)) return false;
  if (value.startsWith("[") || value.startsWith("{") || value.includes("=>")) return false;
  if (/^[a-f\d]{24,}$/iu.test(value)) return true;
  if (!/^[A-Za-z\d+/_=-]{24,}$/u.test(value)) return false;
  return calculateEntropy(value) >= 3.5;
}

function calculateEntropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  return [...counts.values()].reduce((entropy, count) => {
    const probability = count / value.length;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

function extractStringLiterals(line) {
  return Array.from(line.matchAll(/["'`]([^"'`]+)["'`]/gu), (match) => match[1]);
}
