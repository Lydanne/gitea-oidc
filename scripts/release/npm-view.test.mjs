import assert from "node:assert/strict";
import test from "node:test";

import { isExplicitNpmE404, viewNpmPackage } from "./npm-view.mjs";

test("仅识别 npm 明确返回的 E404", () => {
  assert.equal(isExplicitNpmE404("npm error code E404\nnpm error 404 Not Found"), true);
  assert.equal(isExplicitNpmE404("npm error 404 Not Found"), false);
  assert.equal(isExplicitNpmE404("npm error code E401"), false);
  assert.equal(isExplicitNpmE404("request failed: socket timeout"), false);
});

test("首次发布时将明确 E404 转为空结果", () => {
  const spawn = () => ({
    status: 1,
    stdout: "",
    stderr: "npm error code E404\nnpm error 404 Not Found",
  });

  assert.equal(viewNpmPackage("@x-oidc/server-core", "versions", "[]", spawn), "[]");
});

test("网络和鉴权失败不得伪装成首次发布", () => {
  for (const stderr of ["npm error code E401", "request failed: socket timeout"]) {
    const spawn = () => ({ status: 1, stdout: "", stderr });
    assert.throws(
      () => viewNpmPackage("@x-oidc/server-core", "versions", "[]", spawn),
      new RegExp(stderr.replaceAll(/[^A-Za-z0-9]+/gu, ".*"), "u"),
    );
  }

  const timeout = new Error("registry request timed out");
  assert.throws(
    () =>
      viewNpmPackage("@x-oidc/server-core", "versions", "[]", () => ({
        error: timeout,
        status: null,
        stdout: "",
        stderr: "",
      })),
    timeout,
  );
});

test("注册表成功响应必须包含 JSON", () => {
  assert.equal(
    viewNpmPackage("@x-oidc/server-core", "versions", "[]", () => ({
      status: 0,
      stdout: '["1.0.0"]\n',
      stderr: "",
    })),
    '["1.0.0"]',
  );
  assert.throws(
    () =>
      viewNpmPackage("@x-oidc/server-core", "versions", "[]", () => ({
        status: 0,
        stdout: "",
        stderr: "",
      })),
    /未返回 JSON/u,
  );
});
