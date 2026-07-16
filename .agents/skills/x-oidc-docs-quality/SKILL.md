---
name: x-oidc-docs-quality
description: >-
  Use when writing, editing, reorganizing, pruning, reviewing, or validating
  documentation in this x-oidc repository, including README files, docs
  for users, docs/dev for maintainers, Markdown formatting, link maintenance,
  examples, commands, configuration snippets, and removal of stale content.
---

# X OIDC Docs Quality

Use this skill whenever a task touches `README.md`, `README.en.md`, `docs/`,
or documentation embedded in examples.

## Workflow

1. Decide the audience before editing: user/deployer/operator or developer/maintainer.
2. Put user-facing docs in `docs/`; put developer-facing docs in `docs/dev/`.
3. Put AI-generated temporary proposals and TODO drafts in `docs/spec/`.
4. Prefer current, executable guidance over historical notes.
5. Remove stale summaries, temporary logs, personal environment details, duplicate pages,
   and outdated setup paths.
6. Keep docs linked from the right index: `docs/README.md`, `docs/dev/README.md`, or
   `docs/spec/README.md`.
7. Update README links when top-level documentation navigation changes.
8. Run Markdown lint and local link checks after moving or deleting docs.

## Local References

- Read `references/writing-style.md` before writing or rewriting documentation.
- Read `references/organization-rules.md` before moving, deleting, or adding docs.
- Read `references/cleanup-checklist.md` before pruning content.
- Read `references/validation.md` before finishing documentation work.
- Use `$x-oidc-spec-drafts` for temporary AI proposals and TODO drafts under `docs/spec/`.

## Definition Of Done

- The target audience is clear from the file location and title.
- Commands, paths, config examples, and package names match the current repository.
- No real secrets, personal domains, local IPs, or one-off debugging logs remain.
- Index pages and cross-links point to existing files.
- `pnpm lint:md` passes, or the final response explains why it could not run.
