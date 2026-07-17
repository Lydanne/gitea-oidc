---
name: x-oidc-spec-drafts
description: >-
  Use when creating, editing, reviewing, pruning, or promoting AI-generated
  temporary proposals, TODO drafts, implementation plans, design alternatives,
  and review notes under docs/spec in this x-oidc repository.
---

# X OIDC Spec Drafts

Use this skill for `docs/spec/` work. Spec drafts are allowed to be temporary,
but they must be structured, reviewable, and disposable.

## Workflow

1. Confirm the draft belongs in `docs/spec/`, not `docs/` or `docs/dev/`.
2. Name new drafts as `YYYY-MM-DD-topic.md`.
3. Start from `docs/spec/TEMPLATE.md`.
4. Mark AI-generated ideas as drafts, not facts.
5. Keep TODO items concrete and verifiable.
6. Define acceptance criteria and an exit condition before finishing.
7. When a draft is implemented, move durable knowledge to `docs/dev/` or formal docs,
   then delete or shrink the draft.

## Local References

- Read `references/spec-lifecycle.md` before creating or reviewing a draft.
- Read `references/spec-template-rules.md` before editing draft content.
- Read `references/promotion-rules.md` when turning a draft into implementation or docs.

## Definition Of Done

- The draft has metadata, status, scope, TODO, acceptance criteria, and exit conditions.
- The content contains no real secrets, personal domains, private IPs, or raw logs.
- The draft is linked only from developer-facing context when needed.
- `pnpm lint:md` passes after Markdown changes.
