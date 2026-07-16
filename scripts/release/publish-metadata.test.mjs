import assert from "node:assert/strict";
import test from "node:test";

import { createPublishMetadata, formatPublishMetadata } from "./publish-metadata.mjs";

test("稳定版发布到 latest 通道", () => {
  assert.deepEqual(createPublishMetadata("1.2.3", { latest: "1.2.2" }), {
    version: "1.2.3",
    tag: "v1.2.3",
    prerelease: false,
    currentChannelVersion: "1.2.2",
    advanceChannel: true,
    publishDistTag: "latest",
    dockerChannel: "latest",
  });
});

test("预发布使用 preid 作为 npm 与 Docker 通道", () => {
  assert.deepEqual(createPublishMetadata("2.0.0-rc.4"), {
    version: "2.0.0-rc.4",
    tag: "v2.0.0-rc.4",
    prerelease: true,
    currentChannelVersion: "",
    advanceChannel: true,
    publishDistTag: "rc",
    dockerChannel: "rc",
  });
});

test("恢复历史版本时不回滚浮动通道", () => {
  assert.deepEqual(createPublishMetadata("1.2.3", { latest: "1.4.0" }), {
    version: "1.2.3",
    tag: "v1.2.3",
    prerelease: false,
    currentChannelVersion: "1.4.0",
    advanceChannel: false,
    publishDistTag: "recovered-1-2-3",
    dockerChannel: "latest",
  });
  assert.equal(createPublishMetadata("2.0.0-rc.2", { rc: "2.0.0-rc.5" }).advanceChannel, false);
});

test("GitHub Actions 输出保持单行键值", () => {
  assert.equal(
    formatPublishMetadata(createPublishMetadata("2.0.0-beta.1"), "github"),
    [
      "version=2.0.0-beta.1",
      "tag=v2.0.0-beta.1",
      "prerelease=true",
      "currentChannelVersion=",
      "advanceChannel=true",
      "publishDistTag=beta",
      "dockerChannel=beta",
    ].join("\n"),
  );
});
