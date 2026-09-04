#!/usr/bin/env bash
#
# Asserts this repository's own invariants — the things that are true by
# convention rather than by the compiler, and so break silently.
#
# Run by `make ci`. If you add an invariant, it goes here.

set -uo pipefail
cd "$(dirname "$0")/.."

FAILED=0

ok()   { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; FAILED=1; }

# 1. Every shell script parses. A syntax error in a release script is invisible
#    until the release runs, which is the path that runs least and matters most.
for script in build/*.sh build/hooks/*; do
    [[ -f "${script}" ]] || continue
    if bash -n "${script}" 2>/tmp/tradingsg-parse.err; then
        ok "parses: ${script}"
    else
        fail "syntax error in ${script}: $(cat /tmp/tradingsg-parse.err)"
    fi
done

# 2. No secret has been committed. Every credential belongs in the environment,
#    and a key in git history is a key that has to be rotated, not deleted.
SECRET_NAMES='FINNHUB_API_KEY|RESEND_API_KEY|SMTP_PASSWORD|CRON_SECRET|DATABASE_URL'
if grep -rnE "(${SECRET_NAMES})[[:space:]]*[=:][[:space:]]*[\"'][A-Za-z0-9_/+-]{12,}[\"']" \
        --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.json' \
        --include='*.yml' --include='*.sh' \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated \
        . 2>/dev/null | grep -v '\.env\.example'; then
    fail "a credential looks hard-coded above — move it to the environment"
else
    ok "no hard-coded credentials"
fi

# 3. .env is not tracked. .env.example is.
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
    fail ".env is tracked by git — it holds real values and must not be"
else
    ok ".env is not tracked"
fi
if [[ -f .env.example ]]; then
    ok ".env.example exists"
else
    fail ".env.example is missing — it is the only documentation of what to set"
fi

# 4. Every variable read by src/lib/env.ts appears in .env.example. A variable
#    that exists in code but not in the template is a variable nobody knows to
#    set, and it fails at runtime on someone else's machine.
if [[ -f src/lib/env.ts && -f .env.example ]]; then
    missing=""
    while read -r name; do
        [[ -z "${name}" ]] && continue
        [[ "${name}" == "NODE_ENV" ]] && continue
        grep -qE "^#? *${name}=" .env.example || missing="${missing} ${name}"
    done < <(grep -oE '^  [A-Z][A-Z0-9_]+:' src/lib/env.ts | tr -d ' :')
    if [[ -n "${missing}" ]]; then
        fail "env vars read by src/lib/env.ts but absent from .env.example:${missing}"
    else
        ok "every env var is documented in .env.example"
    fi
fi

# 5. Provider names stay behind their seams. The whole point of the adapter
#    layer is that swapping a provider touches one file; a stray import
#    elsewhere silently undoes that without breaking a test.
for provider in finnhub resend nodemailer; do
    hits=""
    while read -r file; do
        # Comment lines are excluded on purpose. What matters is whether code
        # is coupled to a provider — an import, an identifier, a string. A doc
        # comment naming one is documentation, and a check that fires on prose
        # is a check people weaken rather than obey.
        if grep -vE '^[[:space:]]*(//|\*|/\*)' "${file}" | grep -qiE "\b${provider}\b"; then
            hits="${hits} ${file}"
        fi
    done < <(grep -rlniE "\b${provider}\b" \
        --include='*.ts' --include='*.tsx' \
        --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=generated \
        src 2>/dev/null | grep -viE "src/server/(market|email)/(${provider}|index)\.ts$" \
                        | grep -viE "src/lib/env\.ts$" || true)
    if [[ -n "${hits}" ]]; then
        fail "'${provider}' is named in code outside its adapter:${hits}"
    else
        ok "'${provider}' stays behind its adapter"
    fi
done

# 6. The Prisma schema stays portable. A native enum or a @db. annotation
#    compiles on one provider and fails on the other, and the failure arrives at
#    deploy time rather than here.
if grep -qE '^\s*enum\s' prisma/schema.prisma; then
    fail "prisma/schema.prisma declares a native enum — SQLite has none; use a String plus a Zod union"
else
    ok "schema declares no native enums"
fi
if grep -vE '^\s*//' prisma/schema.prisma | grep -qE '@db\.'; then
    fail "prisma/schema.prisma uses a @db. type annotation, which is provider-specific"
else
    ok "schema uses no provider-specific type annotations"
fi

# 7. Money never becomes a float. A Float column in this schema is a silent
#    rounding bug that only shows up as an unexplained leaderboard position.
if grep -nE '^\s+\w+\s+Float' prisma/schema.prisma; then
    fail "a Float column exists above — money is BigInt cents and ratios are Int ppm"
else
    ok "no Float columns in the schema"
fi

echo ""
if [[ ${FAILED} -eq 0 ]]; then
    echo "check-scripts: green"
else
    echo "check-scripts: FAILED" >&2
fi
exit ${FAILED}
