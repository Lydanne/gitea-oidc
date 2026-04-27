# Writing Style

## Language

- Use Chinese for repository documentation unless the file is explicitly English.
- Keep English technical names as-is: OIDC, OAuth, Fastify, Redis, SQLite, JWKS, Gitea.
- Write in direct operational language: what to configure, what to run, what to expect.

## Structure

- Use one `#` title per Markdown file.
- Use `##` for major sections and avoid skipping heading levels.
- Put prerequisites before commands.
- Put validation steps after setup.
- Put troubleshooting near the end.
- Put references at the end only when they help the reader continue.

## Formatting

- Wrap paths, commands, env vars, config fields, package names, and symbols in backticks.
- Use fenced code blocks with language identifiers such as `bash`, `json`, `javascript`,
  `typescript`, `yaml`, or `nginx`.
- Keep tables for compact comparisons or option lists; avoid huge tables for narrative content.
- Prefer short paragraphs and flat lists.
- Avoid decorative emoji in new docs. Keep existing emoji only when preserving a file's style.

## Examples

- Use placeholders for secrets: `change-this-client-secret`, `your-domain.com`,
  `your-password`, `cli_your_app_id`.
- Do not include real tokens, real passwords, local tunnel domains, private IPs, or personal paths.
- Config examples must match `src/config.ts`, `src/types/config.ts`, and
  `src/schemas/configSchema.ts`.
- Command examples must match `package.json`.
