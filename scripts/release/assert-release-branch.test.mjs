import assert from "node:assert/strict";
import test from "node:test";

import { assertReleaseBranchState } from "./assert-release-branch.mjs";

const sha = "1111111111111111111111111111111111111111";

test("接受只包含一个发布提交且基于当前 main 的分支", () => {
  assert.doesNotThrow(() =>
    assertReleaseBranchState({
      expectedBaseSha: sha,
      recordedBaseSha: sha,
      mergeBaseSha: sha,
      aheadCount: 1,
    }),
  );
});

test("拒绝缺少规划基线 trailer 的旧分支", () => {
  assert.throws(
    () =>
      assertReleaseBranchState({
        expectedBaseSha: sha,
        recordedBaseSha: "",
        mergeBaseSha: sha,
        aheadCount: 1,
      }),
    /缺少 Release-Plan-Base/u,
  );
});

test("拒绝 main 已经前进的过期分支", () => {
  assert.throws(
    () =>
      assertReleaseBranchState({
        expectedBaseSha: "2222222222222222222222222222222222222222",
        recordedBaseSha: sha,
        mergeBaseSha: sha,
        aheadCount: 1,
      }),
    /已经过期/u,
  );
});

test("拒绝混入额外提交的发布分支", () => {
  assert.throws(
    () =>
      assertReleaseBranchState({
        expectedBaseSha: sha,
        recordedBaseSha: sha,
        mergeBaseSha: sha,
        aheadCount: 2,
      }),
    /只包含一个自动生成提交/u,
  );
});
