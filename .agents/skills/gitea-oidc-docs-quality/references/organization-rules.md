# Organization Rules

## User-Facing Docs In `docs/`

Use `docs/` for documents that help someone install, configure, deploy, operate, or troubleshoot
the project:

- Quick start
- Server usage
- Production setup
- Reverse proxy and HTTPS
- Adapter configuration
- Provider setup, such as Feishu
- Operational troubleshooting

## Developer Docs In `docs/dev/`

Use `docs/dev/` for documents that help maintain or extend the codebase:

- Architecture and design
- Plugin development
- Dynamic route implementation
- Release and CI maintenance
- Internal coding and validation workflows

## Index Rules

- `docs/README.md` lists user-facing docs and links to `docs/dev/README.md`.
- `docs/dev/README.md` lists developer docs and links back to `docs/README.md`.
- README files should link to index pages instead of listing every internal doc unless a doc is
  important for first-run use.

## Moving Docs

- Use relative links after moving files.
- Update cross-links in `README.md`, `README.en.md`, `docs/README.md`, and
  `docs/dev/README.md`.
- Search old file names with `rg` after moves.
- Preserve useful developer docs under `docs/dev/`; delete stale completion reports instead of
  moving them.
