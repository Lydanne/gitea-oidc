# Spec Lifecycle

## Status Values

- `draft`: Initial AI or developer proposal. It is not approved.
- `reviewing`: Under human review. Do not implement blindly.
- `accepted`: Approved direction. Implementation can proceed.
- `implemented`: Work is done. Promote durable knowledge or delete the draft.
- `rejected`: Direction was declined. Keep only a short reason if useful.

## Lifespan

- Drafts should be short-lived.
- Long-lived architecture decisions belong in `docs/dev/`.
- User-facing behavior belongs in `docs/`.
- Completed TODO lists should be removed or converted into durable docs.

## Required Metadata

- Status
- Creation date
- Source, such as AI assisted or human-authored
- Related module or files
- Related task or issue when available
- Expected handling after implementation

## Review Questions

- Is the problem real and current?
- Is the proposed scope narrow enough?
- Are risks, compatibility, and tests covered?
- Are TODO items actionable?
- Does the exit condition say what happens after implementation?
