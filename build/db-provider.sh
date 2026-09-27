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
    sqlite)     EXAMPLE_URL="file:./tradingsg.db" ;;
    postgresql) EXAMPLE_URL="postgres://user:pass@host/db?sslmode=require" ;;
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
python3 - "$TARGET" <<'PY'
import pathlib, re, sys

target = sys.argv[1]

schema = pathlib.Path("prisma/schema.prisma")
text = schema.read_text()
block = re.search(r'datasource db \{\n  provider = "([a-z]+)"\n\}', text)
if block is None:
    raise SystemExit("Could not find the datasource block. Refusing to guess.")
schema.write_text(text.replace(block.group(0), f'datasource db {{\n  provider = "{target}"\n}}'))

print(f"switched prisma/schema.prisma to {target}")
PY

echo ""
echo "Next:"
echo "  1. set DATABASE_URL to a ${TARGET} connection string, e.g."
echo "       ${EXAMPLE_URL}"
echo "  2. rm -rf prisma/migrations && npx prisma migrate dev --name init"
echo ""
echo "Both adapters are installed and the driver is chosen from DATABASE_URL's"
echo "scheme at runtime, so no source file needs editing."
echo ""
echo "Step 2 discards the old migration history. That is intended — a migration"
echo "file is dialect-specific SQL and cannot be replayed on the other engine."
