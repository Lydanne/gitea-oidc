import assert from "node:assert/strict";
import test from "node:test";

import { resolveNpmRegistryState, resolveReleaseMode } from "./release-mode.mjs";

const base = {
  eventName: "push",
  packageName: "@x-oidc/server-core",
  version: "2.0.0",
  tagExists: false,
  npmVersions: [],
};

test("包尚不存在时自动发布只进入 bootstrap 门禁", () => {
  assert.deepEqual(resolveReleaseMode(base), {
    bootstrapMode: false,
    bootstrapRequired: true,
    packageExists: false,
    npmPublished: false,
    shouldRelease: true,
  });
});

test("精确确认后允许从 main 执行首次发布", () => {
  assert.deepEqual(
    resolveReleaseMode({
      ...base,
      eventName: "workflow_dispatch",
      bootstrapConfirmation: "publish @x-oidc/server-core@2.0.0",
    }),
    {
      bootstrapMode: true,
      bootstrapRequired: false,
      packageExists: false,
      npmPublished: false,
      shouldRelease: true,
    },
  );
});

test("首次发布确认必须包含精确包名和版本", () => {
  assert.throws(
    () =>
      resolveReleaseMode({
        ...base,
        eventName: "workflow_dispatch",
        bootstrapConfirmation: "publish @x-oidc/server-core",
      }),
    /必须精确填写/u,
  );
});

test("首次发布不能与 tag 恢复输入混用", () => {
  assert.throws(
    () =>
      resolveReleaseMode({
        ...base,
        eventName: "workflow_dispatch",
        resumeTag: "v2.0.0",
        bootstrapConfirmation: "publish @x-oidc/server-core@2.0.0",
      }),
    /不能在同一次运行中同时启用/u,
  );
});

test("已有包的新版本禁止再次使用 bootstrap Token", () => {
  assert.throws(
    () =>
      resolveReleaseMode({
        ...base,
        eventName: "workflow_dispatch",
        bootstrapConfirmation: "publish @x-oidc/server-core@2.0.0",
        npmVersions: ["1.0.0"],
      }),
    /配置 Trusted Publisher/u,
  );
});

test("bootstrap 已发布但 tag 创建失败时允许校验后补建 tag", () => {
  const state = resolveReleaseMode({
    ...base,
    eventName: "workflow_dispatch",
    bootstrapConfirmation: "publish @x-oidc/server-core@2.0.0",
    npmVersions: ["2.0.0"],
  });

  assert.equal(state.bootstrapMode, true);
  assert.equal(state.npmPublished, true);
  assert.equal(state.shouldRelease, true);
});

test("普通流程拒绝 npm 已发布但 tag 缺失的状态", () => {
  assert.throws(
    () => resolveReleaseMode({ ...base, npmVersions: ["2.0.0"] }),
    /手动运行一次性 bootstrap 恢复/u,
  );
});

test("包不存在时拒绝复用预先创建的 tag", () => {
  assert.throws(() => resolveReleaseMode({ ...base, tagExists: true }), /npm 包尚不存在/u);
});

test("普通恢复要求 tag 与包版本一致且已经存在", () => {
  const state = resolveReleaseMode({
    ...base,
    eventName: "workflow_dispatch",
    resumeTag: "v2.0.0",
    tagExists: true,
    npmVersions: ["2.0.0"],
  });

  assert.equal(state.bootstrapMode, false);
  assert.equal(state.shouldRelease, true);
  assert.throws(
    () =>
      resolveReleaseMode({
        ...base,
        eventName: "workflow_dispatch",
        resumeTag: "v2.0.1",
        tagExists: true,
      }),
    /不一致/u,
  );
});

test("已完成的 push 不会重复发布", () => {
  assert.deepEqual(
    resolveReleaseMode({
      ...base,
      tagExists: true,
      npmVersions: ["2.0.0"],
    }),
    {
      bootstrapMode: false,
      bootstrapRequired: false,
      packageExists: true,
      npmPublished: true,
      shouldRelease: false,
    },
  );
});

test("bootstrap 重跑时实时识别 Registry 状态", () => {
  assert.equal(resolveNpmRegistryState([], "2.0.0"), "package-missing");
  assert.equal(resolveNpmRegistryState("2.0.0", "2.0.0"), "version-exists");
  assert.equal(resolveNpmRegistryState(["1.9.0"], "2.0.0"), "package-exists");
});

test("bootstrap 状态检查拒绝异常 Registry 版本响应", () => {
  assert.throws(
    () => resolveNpmRegistryState({ version: "2.0.0" }, "2.0.0"),
    /必须是非空版本字符串/u,
  );
});
