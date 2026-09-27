#!/usr/bin/env bash
#
# Verifies the PostgreSQL deployment path end to end, with nothing to install:
# starts PGlite (PostgreSQL 18 compiled to WASM) on a TCP socket, generates the
# Postgres DDL from the schema, applies it, and drives the real Prisma client
# against it.
#
#     make ci-postgres
#
# Deliberately NOT part of `make ci`: it rewrites prisma/schema.prisma's
# provider line while it runs and puts it back afterwards, which is too
# invasive for the gate that runs on every push. Run it when the schema
# changes, and before a deploy.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PG_PORT:-5433}"
DDL="$(mktemp -t tradingsg-pg-ddl)"
SERVER_PID=""
ORIGINAL_PROVIDER="$(grep -oE '^  provider = "(sqlite|postgresql)"' prisma/schema.prisma | head -1 | cut -d'"' -f2)"

cleanup() {
    local status=$?
    [[ -n "${SERVER_PID}" ]] && kill "${SERVER_PID}" 2>/dev/null || true
    rm -f "${DDL}"
    # Always put the schema back, including on failure: leaving the repo on the
    # other dialect would make the next `make ci` fail for an unrelated reason.
    local now
    now="$(grep -oE '^  provider = "(sqlite|postgresql)"' prisma/schema.prisma | head -1 | cut -d'"' -f2)"
    if [[ "${now}" != "${ORIGINAL_PROVIDER}" ]]; then
        bash build/db-provider.sh "${ORIGINAL_PROVIDER}" >/dev/null
        npx prisma generate >/dev/null 2>&1
        echo "restored schema provider to ${ORIGINAL_PROVIDER}"
    fi
    exit "${status}"
}
trap cleanup EXIT

echo "── PostgreSQL deploy check ───────────────────────────────────────────────"

if [[ "${ORIGINAL_PROVIDER}" != "postgresql" ]]; then
    bash build/db-provider.sh postgresql >/dev/null
fi
npx prisma generate >/dev/null
echo "  ✓ Prisma client generates for postgresql"

npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script > "${DDL}" 2>/dev/null
tables="$(grep -c 'CREATE TABLE' "${DDL}" || true)"
if [[ "${tables}" -lt 20 ]]; then
    echo "  ✗ only ${tables} tables in the generated DDL — that cannot be the whole schema" >&2
    exit 1
fi
echo "  ✓ generated Postgres DDL for ${tables} tables"

node build/pg-server.mjs "${PORT}" >/dev/null 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do
    nc -z 127.0.0.1 "${PORT}" 2>/dev/null && break
    sleep 0.5
done
if ! nc -z 127.0.0.1 "${PORT}" 2>/dev/null; then
    echo "  ✗ the PGlite server never started listening on ${PORT}" >&2
    exit 1
fi
echo "  ✓ PostgreSQL listening on ${PORT}"

DATABASE_URL="postgres://postgres:postgres@127.0.0.1:${PORT}/postgres" \
    npx tsx build/pg-verify.ts "${DDL}"

echo "ci-postgres: green"
