import assert from "node:assert/strict";
import test from "node:test";

import {
  findSuspiciousAssignments,
  isExplicitFixture,
  isSuspiciousLiteral,
} from "./sensitive-value-detection.mjs";

test("识别单字段和多行敏感数组中的高熵值", () => {
  const secret = "aB3dE5fG7hJ9kL2mN4pQ6rS8tV0xY1zC";
  assert.deepEqual(
    findSuspiciousAssignments([
      `clientSecret: "${secret}"`,
      "cookieKeys: [",
      `  "${secret}",`,
      "]",
    ]),
    [
      { line: 1, rule: "hardcoded-secret-field" },
      { line: 3, rule: "hardcoded-secret-array" },
    ],
  );
});

test("占位符和环境变量引用不会被当作真实密钥", () => {
  assert.equal(isSuspiciousLiteral("replace-with-random-cookie-key"), false);
  assert.equal(isSuspiciousLiteral("X_OIDC_COOKIE_KEY_CURRENT"), false);
  assert.deepEqual(
    findSuspiciousAssignments([
      "cookieKeys: [",
      '  requiredEnv("X_OIDC_COOKIE_KEY_CURRENT"),',
      "]",
    ]),
    [],
  );
});

test("占位提示只豁免匹配到的值本身", () => {
  assert.equal(isExplicitFixture("replace-with-value"), true);
  assert.equal(isExplicitFixture("aB3dE5fG7hJ9kL2mN4pQ6rS8tV0xY1zC"), false);
});
