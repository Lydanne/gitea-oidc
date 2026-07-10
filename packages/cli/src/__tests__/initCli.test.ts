import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv, promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli.js";
import { createInitPlan, detectFramework, renderEnv, writeInitFile } from "../init.js";
import { createNodeDependencies, createNodeFileSystem } from "../nodeDependencies.js";
import { connection, createDependencies, credential } from "./fixtures.js";

describe("framework detection", () => {
  it("prefers NestJS, then Fastify, Express and native Node", async () => {
    const dependencies = createDependencies({
      packageJson: {
        dependencies: { "@nestjs/common": "^11", express: "^5", fastify: "^5" },
      },
    });
    await expect(detectFramework(dependencies.fileSystem, dependencies.cwd)).resolves.toBe(
      "nestjs",
    );

    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(
      JSON.stringify({ dependencies: { express: "^5", fastify: "^5" } }),
    );
    await expect(detectFramework(dependencies.fileSystem, dependencies.cwd)).resolves.toBe(
      "fastify",
    );

    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(
      JSON.stringify({ devDependencies: { express: "^5" } }),
    );
    await expect(detectFramework(dependencies.fileSystem, dependencies.cwd)).resolves.toBe(
      "express",
    );

    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(JSON.stringify({}));
    await expect(detectFramework(dependencies.fileSystem, dependencies.cwd)).resolves.toBe("node");
  });
});

describe("init", () => {
  it("requires and selects the fixed framework callback instead of the first redirect URI", async () => {
    const dependencies = createDependencies();
    const plan = await createInitPlan(
      {
        ...connection,
        redirectUris: [
          "https://app.example.com/custom/callback",
          "https://app.example.com/oidc/callback",
        ],
      },
      dependencies,
    );
    expect(plan.redirectUri).toBe("https://app.example.com/oidc/callback");
    expect(parseEnv(plan.envPreview).GITEA_OIDC_REDIRECT_URI).toBe(
      "https://app.example.com/oidc/callback",
    );

    await expect(
      createInitPlan(
        { ...connection, redirectUris: ["https://app.example.com/custom/callback"] },
        dependencies,
      ),
    ).rejects.toThrow("未注册 /oidc/callback 回调");
  });

  it("allows the native package to adapt an arbitrary registered callback", async () => {
    const dependencies = createDependencies({ packageJson: {} });
    const plan = await createInitPlan(
      { ...connection, redirectUris: ["https://app.example.com/custom/callback"] },
      dependencies,
    );

    expect(plan.framework).toBe("node");
    expect(plan.redirectUri).toBe("https://app.example.com/custom/callback");
  });

  it("is a dry-run by default and never reads credentials", async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(["init", "/connection.json"], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.fileSystem.readSecureTextFile).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
    expect(dependencies.terminal.prompt).not.toHaveBeenCalled();
    expect(dependencies.terminal.promptHidden).not.toHaveBeenCalled();
    const output = dependencies.stdoutText.join("");
    expect(output).toContain("推荐包：@gitea-oidc/express");
    expect(output).toContain("[REDACTED: 通过安全输入提供]");
    expect(output).toContain("dry-run");
  });

  it("requires an interactive TTY before writing", async () => {
    const dependencies = createDependencies({ interactive: false });

    const exitCode = await runCli(["init", "/connection.json", "--write"], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain("只能在交互式 TTY");
    expect(dependencies.terminal.prompt).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it.each([
    ["hidden input", ["init", "/connection.json", "--write"]],
    [
      "credential file",
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
    ],
  ])("fails closed before reading a confidential client secret from %s", async (_name, args) => {
    const dependencies = createDependencies({ supportsSecureSecretWrite: false });

    const exitCode = await runCli(args, dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain("当前平台无法可靠限制 Secret 文件");
    expect(dependencies.terminal.prompt).not.toHaveBeenCalled();
    expect(dependencies.terminal.promptHidden).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.readSecureTextFile).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it("still writes a public client config when secure secret writes are unavailable", async () => {
    const publicConnection = {
      ...connection,
      clientType: "public" as const,
      clientAuthMethod: "none" as const,
    };
    const dependencies = createDependencies({ supportsSecureSecretWrite: false });
    dependencies.fileSystem.readTextFile.mockResolvedValueOnce(JSON.stringify(publicConnection));

    const exitCode = await runCli(["init", "/connection.json", "--write"], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.terminal.prompt).toHaveBeenCalledTimes(1);
    expect(dependencies.terminal.promptHidden).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.readSecureTextFile).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).toHaveBeenCalledWith(
      "/workspace/.env.gitea-oidc",
      expect.not.stringContaining("GITEA_OIDC_CLIENT_SECRET"),
      0o600,
    );
    expect(dependencies.stdoutText.join("")).toContain("不含 client secret");
  });

  it("does not read a credential when the user cancels", async () => {
    const dependencies = createDependencies();
    dependencies.terminal.prompt.mockResolvedValue("no");

    const exitCode = await runCli(
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.fileSystem.readSecureTextFile).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
    expect(dependencies.stdoutText.join("")).toContain("已取消");
  });

  it("writes a credential file result exclusively with mode 0600 and never prints the secret", async () => {
    const secret = "safe-secret-value-123";
    const dependencies = createDependencies({
      secureFile: {
        content: JSON.stringify({ ...credential, clientSecret: secret }),
        isFile: true,
        mode: 0o600,
        uid: 501,
      },
    });

    const exitCode = await runCli(
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
      dependencies,
    );

    expect(exitCode).toBe(0);
    expect(dependencies.fileSystem.readSecureTextFile).toHaveBeenCalledWith(
      "/credential.json",
      16 * 1024,
    );
    expect(dependencies.fileSystem.writeTextFileExclusive).toHaveBeenCalledWith(
      "/workspace/.env.gitea-oidc",
      expect.stringContaining(`GITEA_OIDC_CLIENT_SECRET='${secret}'`),
      0o600,
    );
    expect(dependencies.terminal.promptHidden).not.toHaveBeenCalled();
    expect(dependencies.stdoutText.join("")).not.toContain(secret);
    expect(dependencies.stderrText.join("")).not.toContain(secret);
  });

  it("rejects credential files with group or other permissions", async () => {
    const dependencies = createDependencies({
      secureFile: {
        content: JSON.stringify({
          ...credential,
          clientSecret: "must-never-be-printed",
        }),
        isFile: true,
        mode: 0o640,
        uid: 501,
      },
    });

    const exitCode = await runCli(
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain("权限过宽");
    expect(dependencies.stderrText.join("")).not.toContain("must-never-be-printed");
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it("uses a hidden prompt when no credential file is provided", async () => {
    const dependencies = createDependencies();
    const plan = await createInitPlan(connection, dependencies);

    await expect(writeInitFile(plan, connection, {}, dependencies)).resolves.toBe("written");

    expect(dependencies.terminal.promptHidden).toHaveBeenCalledTimes(1);
    expect(dependencies.fileSystem.writeTextFileExclusive).toHaveBeenCalledWith(
      plan.targetPath,
      expect.stringContaining("safe-secret-value-123"),
      0o600,
    );
  });

  it("fails closed before prompting when the target is not gitignored", async () => {
    const dependencies = createDependencies({ gitIgnored: false });

    const exitCode = await runCli(["init", "/connection.json", "--write"], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain(".gitignore");
    expect(dependencies.stderrText.join("")).toContain("printf");
    expect(dependencies.terminal.prompt).not.toHaveBeenCalled();
    expect(dependencies.terminal.promptHidden).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.readSecureTextFile).not.toHaveBeenCalled();
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it("rejects a credential bound to another connection without printing the secret", async () => {
    const secret = "must-never-be-printed";
    const dependencies = createDependencies({
      secureFile: {
        content: JSON.stringify({
          ...credential,
          oidcClientId: "other-client",
          clientSecret: secret,
        }),
        isFile: true,
        mode: 0o600,
        uid: 501,
      },
    });

    const exitCode = await runCli(
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain("不匹配");
    expect(dependencies.stderrText.join("")).not.toContain(secret);
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it("fails closed when credential ownership metadata is unavailable", async () => {
    const dependencies = createDependencies({
      secureFile: {
        content: JSON.stringify(credential),
        isFile: true,
        mode: 0o600,
      },
    });

    const exitCode = await runCli(
      ["init", "/connection.json", "--write", "--credential-file", "/credential.json"],
      dependencies,
    );

    expect(exitCode).toBe(1);
    expect(dependencies.stderrText.join("")).toContain("无法可靠验证");
    expect(dependencies.fileSystem.writeTextFileExclusive).not.toHaveBeenCalled();
  });

  it("uses dotenv encodings that round-trip special characters", () => {
    const secret = 'safe"$HOME\\path`tick-value';
    const content = renderEnv(connection, secret);

    expect(parseEnv(content).GITEA_OIDC_CLIENT_SECRET).toBe(secret);
    expect(content).toContain("禁止使用 shell source");

    const singleQuoteClientId = "client'id";
    expect(
      parseEnv(renderEnv({ ...connection, clientId: singleQuoteClientId }, secret))
        .GITEA_OIDC_CLIENT_ID,
    ).toBe(singleQuoteClientId);
    expect(() => renderEnv({ ...connection, clientId: "client'$HOME" }, secret)).toThrow(
      "无法在保持 dotenv 原值",
    );
  });
});

describe("CLI argument safety", () => {
  it("rejects command-line secrets without echoing their value", async () => {
    const dependencies = createDependencies();
    const exitCode = await runCli(
      ["init", "/connection.json", "--client-secret=must-never-be-printed"],
      dependencies,
    );

    expect(exitCode).toBe(2);
    const output = `${dependencies.stdoutText.join("")}${dependencies.stderrText.join("")}`;
    expect(output).not.toContain("must-never-be-printed");
    expect(output).toContain("--client-secret");
  });

  it("requires --redact for config print", async () => {
    const dependencies = createDependencies();

    const exitCode = await runCli(["config", "print", "/connection.json"], dependencies);

    expect(exitCode).toBe(2);
    expect(dependencies.stderrText.join("")).toContain("必须显式使用 --redact");
  });
});

describe("Node filesystem adapter", () => {
  it("creates mode 0600 files exclusively and rejects credential symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitea-oidc-cli-"));
    const fileSystem = createNodeFileSystem();
    const outputPath = join(directory, ".env.gitea-oidc");
    try {
      expect(fileSystem.supportsSecureSecretWrite).toBe(process.platform !== "win32");
      await fileSystem.writeTextFileExclusive(outputPath, "KEY='value'\n", 0o600);

      expect(await readFile(outputPath, "utf8")).toBe("KEY='value'\n");
      expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
      await expect(
        fileSystem.writeTextFileExclusive(outputPath, "OTHER='value'\n", 0o600),
      ).rejects.toMatchObject({ code: "EEXIST" });

      if (process.platform !== "win32") {
        const credentialPath = join(directory, "credential.json");
        const symlinkPath = join(directory, "credential-link.json");
        await writeFile(credentialPath, "{}", { mode: 0o600 });
        await symlink(credentialPath, symlinkPath);
        await expect(fileSystem.readSecureTextFile(symlinkPath, 1024)).rejects.toBeDefined();
      }
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("checks the actual Git ignore rules without tracking the target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gitea-oidc-cli-gitignore-"));
    try {
      await promisify(execFile)("git", ["init", "--quiet", directory]);
      await writeFile(join(directory, ".gitignore"), ".env.gitea-oidc\n");
      const checker = createNodeDependencies().gitIgnoreChecker;

      await expect(checker.isIgnored(directory, join(directory, ".env.gitea-oidc"))).resolves.toBe(
        true,
      );
      await expect(checker.isIgnored(directory, join(directory, ".env.other"))).resolves.toBe(
        false,
      );

      const trackedTarget = join(directory, ".env.gitea-oidc");
      await writeFile(trackedTarget, "SECRET='placeholder'\n");
      await promisify(execFile)("git", ["-C", directory, "add", "--force", ".env.gitea-oidc"]);
      await rm(trackedTarget);
      await expect(checker.isIgnored(directory, trackedTarget)).resolves.toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
