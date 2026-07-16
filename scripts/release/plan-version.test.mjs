import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCurrentVersionMatchesBaseTag,
  createVersionPlan,
  determineAutomaticBump,
  formatPlan,
  getCommitBump,
  incrementVersion,
  parseArguments,
  parseStableVersion,
  parseVersion,
  selectBaseTag,
  versionFromTag,
} from "./plan-version.mjs";

test("解析稳定与预发布语义化版本和标签", () => {
  assert.deepEqual(parseStableVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion("1.2.3-rc.4"), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: { preid: "rc", number: 4 },
  });
  assert.equal(versionFromTag("v1.2.3"), "1.2.3");
  assert.equal(versionFromTag("v1.2.3-beta.0"), "1.2.3-beta.0");
  assert.throws(() => parseStableVersion("01.2.3"), /Invalid stable semantic version/u);
  assert.throws(() => parseVersion("1.2.3-rc"), /Invalid semantic version/u);
  assert.throws(() => parseVersion("1.2.3-01.0"), /Invalid prerelease identifier/u);
  assert.throws(() => versionFromTag("v1.2.3-rc"), /Invalid release tag/u);
});

test("识别功能、修复和性能提交的版本级别", () => {
  assert.equal(getCommitBump("feat(portal): add navigation"), "minor");
  assert.equal(getCommitBump("fix(server-core): handle missing token"), "patch");
  assert.equal(getCommitBump("perf: reduce lookup time"), "patch");
  assert.equal(getCommitBump("revert: restore stable callback handling"), "patch");
});

test("忽略不触发发布的提交类型和非约定式提交", () => {
  assert.equal(getCommitBump("docs: update deployment guide"), "none");
  assert.equal(getCommitBump("chore: refresh fixtures"), "none");
  assert.equal(getCommitBump("plain commit message"), "none");
});

test("感叹号标记的破坏性变更触发 major", () => {
  assert.equal(getCommitBump("feat!: remove legacy endpoint"), "major");
  assert.equal(getCommitBump("fix(api)!: change response shape"), "major");
});

test("BREAKING footer 触发 major", () => {
  assert.equal(getCommitBump("BREAKING: remove legacy API"), "major");
  assert.equal(
    getCommitBump("feat: update claims\n\nBREAKING CHANGE: claim shape changed"),
    "major",
  );
  assert.equal(getCommitBump("refactor: update API\n\nBREAKING-CHANGE: old API removed"), "major");
});

test("自动级别选择最高优先级", () => {
  assert.equal(determineAutomaticBump(["fix: one", "feat: two", "docs: three"]), "minor");
  assert.equal(determineAutomaticBump(["fix: one", "feat!: two", "feat: three"]), "major");
  assert.equal(determineAutomaticBump(["docs: one", "chore: two"]), "none");
});

test("从稳定版本递增 major、minor、patch 和 prerelease", () => {
  assert.equal(incrementVersion("1.2.3", "major"), "2.0.0");
  assert.equal(incrementVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(incrementVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(incrementVersion("1.2.3", "prerelease"), "1.2.4-rc.0");
  assert.equal(incrementVersion("1.2.3", "prerelease", "beta"), "1.2.4-beta.0");
});

test("预发布推进、切换通道并转为同目标稳定版", () => {
  assert.equal(incrementVersion("1.2.4-rc.2", "prerelease"), "1.2.4-rc.3");
  assert.equal(incrementVersion("1.2.4-rc.2", "prerelease", "rc"), "1.2.4-rc.3");
  assert.equal(incrementVersion("1.2.4-rc.2", "prerelease", "beta"), "1.2.4-beta.0");
  assert.equal(incrementVersion("1.2.4-rc.2", "stable"), "1.2.4");
  assert.throws(() => incrementVersion("1.2.4", "stable"), /requires a prerelease/u);
});

test("显式稳定级别从预发布目标继续递增", () => {
  assert.equal(incrementVersion("1.2.4-rc.2", "patch"), "1.2.5");
  assert.equal(incrementVersion("1.2.4-rc.2", "minor"), "1.3.0");
  assert.equal(incrementVersion("1.2.4-rc.2", "major"), "2.0.0");
});

test("校验稳定与预发布版本的基准标签", () => {
  assert.doesNotThrow(() => assertCurrentVersionMatchesBaseTag("1.2.3", "v1.2.3"));
  assert.doesNotThrow(() => assertCurrentVersionMatchesBaseTag("1.2.4-rc.2", "v1.2.4-rc.2"));
  assert.throws(
    () => assertCurrentVersionMatchesBaseTag("1.2.4", "v1.2.3"),
    /does not match base tag/u,
  );
  assert.throws(
    () => assertCurrentVersionMatchesBaseTag("1.2.4-rc.2", "v1.2.4"),
    /does not match base tag/u,
  );
});

test("稳定版和预发布版都要求精确的已发布标签", () => {
  const candidates = [
    { tag: "v1.2.3", distance: 5 },
    { tag: "v1.2.4-rc.2", distance: 9 },
    { tag: "v1.1.0", distance: 1 },
  ];
  assert.equal(selectBaseTag("1.2.4-rc.2", candidates), "v1.2.4-rc.2");
  assert.throws(
    () => selectBaseTag("1.2.4-rc.3", candidates),
    /No reachable tag matches package version/u,
  );
});

test("基准标签拒绝缺失的精确标签", () => {
  assert.throws(
    () => selectBaseTag("1.2.4-rc.2", [{ tag: "v1.2.4", distance: 1 }]),
    /No reachable tag matches package version/u,
  );
  assert.throws(
    () => selectBaseTag("1.2.4", [{ tag: "v1.2.3", distance: 1 }]),
    /No reachable tag matches package version/u,
  );
});

test("自动规划功能提交的 minor 发布", () => {
  assert.deepEqual(
    createVersionPlan({
      currentVersion: "1.2.3",
      baseTag: "v1.2.3",
      commitMessages: ["docs: update", "feat(portal): add home"],
    }),
    {
      currentVersion: "1.2.3",
      baseTag: "v1.2.3",
      bump: "minor",
      nextVersion: "1.3.0",
      releaseNeeded: true,
      commitCount: 2,
    },
  );
});

test("自动规划无发布提交时保持当前版本", () => {
  assert.deepEqual(
    createVersionPlan({
      currentVersion: "1.2.3",
      baseTag: "v1.2.3",
      commitMessages: ["docs: update", "test: add coverage"],
    }),
    {
      currentVersion: "1.2.3",
      baseTag: "v1.2.3",
      bump: "none",
      nextVersion: "1.2.3",
      releaseNeeded: false,
      commitCount: 2,
    },
  );
});

test("显式 bump 会覆盖自动分析结果", () => {
  const plan = createVersionPlan({
    currentVersion: "1.2.3",
    baseTag: "v1.2.3",
    requestedBump: "patch",
    commitMessages: ["feat!: breaking change"],
  });

  assert.equal(plan.bump, "patch");
  assert.equal(plan.nextVersion, "1.2.4");
  assert.equal(plan.releaseNeeded, true);
});

test("显式 prerelease 使用 preid", () => {
  const plan = createVersionPlan({
    currentVersion: "1.2.3",
    baseTag: "v1.2.3",
    requestedBump: "prerelease",
    preid: "alpha",
    commitMessages: [],
  });

  assert.equal(plan.bump, "prerelease");
  assert.equal(plan.nextVersion, "1.2.4-alpha.0");
  assert.equal(plan.releaseNeeded, true);

  const continued = createVersionPlan({
    currentVersion: "1.2.4-beta.2",
    baseTag: "v1.2.4-beta.2",
    requestedBump: "prerelease",
  });
  assert.equal(continued.nextVersion, "1.2.4-beta.3");
});

test("预发布版本的 auto 只推进当前预发布序号", () => {
  const plan = createVersionPlan({
    currentVersion: "2.0.0-rc.2",
    baseTag: "v2.0.0-rc.2",
    commitMessages: ["feat!: remove legacy API", "feat: add portal"],
  });

  assert.equal(plan.bump, "prerelease");
  assert.equal(plan.nextVersion, "2.0.0-rc.3");
  assert.equal(plan.releaseNeeded, true);
  assert.equal(plan.commitCount, 2);
});

test("预发布版本的 auto 在无发布提交时保持不变", () => {
  const plan = createVersionPlan({
    currentVersion: "2.0.0-beta.1",
    baseTag: "v2.0.0-beta.1",
    commitMessages: ["docs: update guide"],
  });

  assert.equal(plan.bump, "none");
  assert.equal(plan.nextVersion, "2.0.0-beta.1");
  assert.equal(plan.releaseNeeded, false);
});

test("显式 stable 将预发布转为同目标稳定版本", () => {
  const plan = createVersionPlan({
    currentVersion: "2.0.0-rc.3",
    baseTag: "v2.0.0-rc.3",
    requestedBump: "stable",
    commitMessages: [],
  });

  assert.equal(plan.bump, "stable");
  assert.equal(plan.nextVersion, "2.0.0");
  assert.equal(plan.releaseNeeded, true);
});

test("解析分隔和等号形式的命令行参数", () => {
  assert.deepEqual(parseArguments([]), {
    bump: "auto",
    preid: undefined,
    format: "text",
    help: false,
  });
  assert.deepEqual(parseArguments(["--bump=prerelease", "--preid", "beta", "--format=json"]), {
    bump: "prerelease",
    preid: "beta",
    format: "json",
    help: false,
  });
  assert.deepEqual(parseArguments(["--bump", "stable", "--format=github"]), {
    bump: "stable",
    preid: undefined,
    format: "github",
    help: false,
  });
});

test("拒绝无效和无关的命令行参数", () => {
  assert.throws(() => parseArguments(["--bump", "invalid"]), /Unsupported bump/u);
  assert.throws(() => parseArguments(["--format", "yaml"]), /Unsupported format/u);
  assert.throws(() => parseArguments(["--preid", "beta"]), /only be used/u);
  assert.throws(
    () => parseArguments(["--bump", "prerelease", "--preid", "latest"]),
    /Invalid prerelease identifier/u,
  );
  assert.throws(
    () => parseArguments(["--bump", "prerelease", "--preid", "123"]),
    /Invalid prerelease identifier/u,
  );
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/u);
});

test("格式化 text、json 和 GitHub Actions 输出", () => {
  const plan = {
    currentVersion: "1.2.4-rc.2",
    baseTag: "v1.2.4-rc.2",
    bump: "stable",
    nextVersion: "1.2.4",
    releaseNeeded: true,
    commitCount: 2,
  };

  assert.match(formatPlan(plan, "text"), /Current version: 1\.2\.4-rc\.2/u);
  assert.deepEqual(JSON.parse(formatPlan(plan, "json")), plan);
  assert.equal(
    formatPlan(plan, "github"),
    [
      "currentVersion=1.2.4-rc.2",
      "baseTag=v1.2.4-rc.2",
      "bump=stable",
      "nextVersion=1.2.4",
      "releaseNeeded=true",
      "commitCount=2",
    ].join("\n"),
  );
});
