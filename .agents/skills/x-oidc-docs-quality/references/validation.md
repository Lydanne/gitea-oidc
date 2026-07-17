# Validation

## Required Checks

- Run `pnpm lint:md` after Markdown changes.
- Run a local Markdown link check after moving, deleting, or renaming docs.
- Run `rg` for removed filenames to catch stale references.

## Useful Commands

```bash
pnpm lint:md
```

```bash
rg -n "OLD_FILE_NAME|old/path" README.md README.en.md docs -g "*.md"
```

```bash
python3 - <<'PY'
from pathlib import Path
import re

files = [Path("README.md"), Path("README.en.md")] + list(Path("docs").rglob("*.md"))
missing = []
for file in files:
    text = file.read_text()
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    for match in re.finditer(r"\[[^\]]+\]\(([^)]+)\)", text):
        url = match.group(1).strip().split("#", 1)[0]
        if not url or "://" in url or url.startswith("mailto:"):
            continue
        if not (file.parent / url).resolve().exists():
            missing.append((str(file), match.group(1)))

if missing:
    for file, url in missing:
        print(f"{file} -> {url}")
    raise SystemExit(1)
print("local markdown links ok")
PY
```

## Runtime Note

This repository requires Node.js `>=22` and pnpm `>=10`. If the shell defaults are older, use an
available Node 22 installation and Corepack pnpm before treating validation as blocked.
