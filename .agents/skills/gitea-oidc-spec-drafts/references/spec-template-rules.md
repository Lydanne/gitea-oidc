# Spec Template Rules

## Required Sections

- Title
- Metadata
- Background
- Goals
- Non-goals
- Proposal
- Alternatives
- TODO
- Acceptance criteria
- Exit conditions

## Writing Rules

- Use Chinese unless the surrounding task explicitly needs English.
- Use placeholders for secrets and domains.
- Use checkboxes only for tasks that can be completed.
- Keep implementation details at module-boundary level unless the task requires deeper design.
- Do not paste long logs; summarize the signal and link to reproducible commands.

## TODO Quality

Good TODO:

- `- [ ] 在 src/schemas/configSchema.ts 增加 Redis URL 校验`
- `- [ ] 为 Redis 配置错误补充 Vitest 用例`

Weak TODO:

- `- [ ] 优化一下`
- `- [ ] 处理问题`
- `- [ ] 看看代码`

## Acceptance Criteria

Each draft should say how the work will be considered done:

- Behavior changed and covered by tests.
- Docs and examples updated.
- Config/schema/types synchronized.
- Validation commands listed.
