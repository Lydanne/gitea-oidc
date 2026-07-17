const allowedScopes = [
  "x-oidc",
  "admin-web",
  "idp-server",
  "portal-web",
  "application-templates",
  "applications",
  "cli",
  "connector-core",
  "connector-testkit",
  "contracts",
  "express",
  "fastify",
  "nestjs",
  "oidc-client",
  "oidc-client-sqlite",
  "server-core",
];

const subjectContainsChinese = ({ subject }) => [
  /[\u3400-\u9fff]/u.test(subject ?? ""),
  "主题必须包含中文",
];

const subjectHasNoTerminalPunctuation = ({ subject }) => [
  !/[。！？.!?]$/u.test(subject ?? ""),
  "主题结尾不能使用标点",
];

export default {
  extends: ["@commitlint/config-conventional"],
  plugins: [
    {
      rules: {
        "subject-contains-chinese": subjectContainsChinese,
        "subject-no-terminal-punctuation": subjectHasNoTerminalPunctuation,
      },
    },
  ],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "build",
        "ci",
        "chore",
        "revert",
      ],
    ],
    "type-case": [2, "always", "lower-case"],
    "type-empty": [2, "never"],
    "scope-empty": [2, "never"],
    "scope-case": [2, "always", "lower-case"],
    "scope-enum": [2, "always", allowedScopes],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "subject-contains-chinese": [2, "always"],
    "subject-no-terminal-punctuation": [2, "always"],
    "header-max-length": [2, "always", 50],
    "body-max-line-length": [2, "always", 72],
    "body-leading-blank": [1, "always"],
    "footer-leading-blank": [1, "always"],
  },
};
