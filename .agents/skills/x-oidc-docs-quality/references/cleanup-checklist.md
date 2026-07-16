# Cleanup Checklist

## Delete Or Rewrite When Content Is

- A completed phase report with no current operational guidance.
- A temporary debug log or raw command output.
- A duplicate of another maintained guide.
- A one-off environment note with personal domains, local IPs, or real secrets.
- A migration note that only records past implementation history.
- A guide that tells users to edit files that no longer exist.
- A summary whose useful parts are already covered by README or index pages.
- An implemented `docs/spec/` draft whose durable knowledge has been promoted.

## Keep Or Move When Content Is

- A current setup guide for users.
- A production or deployment guide.
- A troubleshooting guide with still-current symptoms and fixes.
- A design document needed by maintainers.
- A plugin or adapter development guide.
- A release or CI guide used by maintainers.
- A current `docs/spec/` draft with clear status, TODO, acceptance criteria, and exit conditions.

## Rewrite Instead Of Delete When

- The topic is useful but commands are stale.
- The file is the canonical guide for a feature.
- README or docs indexes already point users to it.
- External users likely rely on the document name.

## Red Flags

- `IMPLEMENTATION_SUMMARY`, `*_COMPLETE`, `P0_*`, `P1_*`, `log.yaml`.
- Hard-coded tunnel domains or private IPs.
- Real-looking client secrets or tokens.
- References to npm scripts that are not in `package.json`.
- Links to files that no longer exist.
- Spec drafts without status or exit conditions.
