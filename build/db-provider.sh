#!/usr/bin/env bash
#
# Switches the Prisma datasource between SQLite and PostgreSQL.
#
#     bash build/db-provider.sh postgresql     # or: make db-provider-postgres
#
# The schema is written to be dialect-portable — integer cents, String instead
# of native enums, no @db. annotations — so switching really is these two lines.
# What it is NOT is a runtime flag: the migration history is dialect-specific,
# so after switching you must generate a fresh migration against the new
# database. See docs/deployment.md.

set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:-}"
case "${TARGET}" in
    sqlite)     ADAPTER_PKG="@prisma/adapter-better-sqlite3"; ADAPTER_CLASS="PrismaBetterSqlite3" ;;
    postgresql) ADAPTER_PKG="@prisma/adapter-pg";             ADAPTER_CLASS="PrismaPg" ;;
    *)
        echo "usage: $0 {sqlite|postgresql}" >&2
        exit 1
        ;;
esac

CURRENT=$(grep -oE '^  provider = "[a-z]+"' prisma/schema.prisma | head -1 | cut -d'"' -f2)
if [[ "${CURRENT}" == "${TARGET}" ]]; then
    echo "Already on ${TARGET}. Nothing to do."
    exit 0
fi

# Exactly one line in the datasource block, matched by its full text rather than
# by a bare word, so this can never touch the generator block or a comment.
python3 - "$TARGET" "$ADAPTER_PKG" "$ADAPTER_CLASS" <<'PY'
import pathlib, re, sys

target, adapter_pkg, adapter_class = sys.argv[1], sys.argv[2], sys.argv[3]

schema = pathlib.Path("prisma/schema.prisma")
text = schema.read_text()
block = re.search(r'datasource db \{\n  provider = "([a-z]+)"\n\}', text)
if block is None:
    raise SystemExit("Could not find the datasource block. Refusing to guess.")
schema.write_text(text.replace(block.group(0), f'datasource db {{\n  provider = "{target}"\n}}'))

db = pathlib.Path("src/server/db.ts")
src = db.read_text()
src = re.sub(r'import \{ Prisma\w+ \} from "@prisma/adapter-[a-z0-9-]+";',
             f'import {{ {adapter_class} }} from "{adapter_pkg}";', src, count=1)
src = re.sub(r'new Prisma\w+\(\{ url \}\)', f'new {adapter_class}({{ url }})', src, count=1)
db.write_text(src)

cfg = pathlib.Path("prisma.config.ts")
print(f"switched schema and src/server/db.ts to {target} ({adapter_class})")
PY

echo ""
echo "Next:"
echo "  1. npm install ${ADAPTER_PKG}"
echo "  2. set DATABASE_URL in .env to a ${TARGET} connection string"
echo "  3. rm -rf prisma/migrations && npx prisma migrate dev --name init"
echo ""
echo "Step 3 discards the SQLite migration history. That is intended — a"
echo "migration file is dialect-specific SQL and cannot be replayed on the other."
