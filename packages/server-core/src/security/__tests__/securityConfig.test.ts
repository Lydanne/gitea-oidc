import { describe, expect, it } from "vitest";
import { AuthConfigSchema } from "../../schemas/configSchema.js";

describe("初始管理员配置校验", () => {
  const auth = (bootstrapAdmin?: unknown) => ({
    userRepository: { type: "memory" },
    providers: {
      local: {
        enabled: true,
        displayName: "Local",
        config: {
          passwordFile: ".htpasswd",
          passwordFormat: "bcrypt",
          ...(bootstrapAdmin === undefined ? {} : { bootstrapAdmin }),
        },
      },
    },
  });
  it("兼容旧配置和显式初始化配置", () => {
    expect(AuthConfigSchema.safeParse(auth()).success).toBe(true);
    expect(AuthConfigSchema.safeParse(auth({ enabled: false })).success).toBe(true);
    expect(
      AuthConfigSchema.safeParse(
        auth({ enabled: true, credentialsFile: "/app/secrets/admin.bootstrap.json" }),
      ).success,
    ).toBe(true);
  });
  it.each([
    null,
    "true",
    { enabled: "false" },
    { credentialsFile: "" },
    { unknown: true },
  ])("拒绝非法初始化设置 %j", (value) => {
    expect(AuthConfigSchema.safeParse(auth(value)).success).toBe(false);
  });
});
