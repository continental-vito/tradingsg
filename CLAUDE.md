# CLAUDE.md — TradingSG

Project-specific guidance. The workspace-wide conventions in `~/Claude/CLAUDE.md`
still apply; this file adds to them and overrides them where they disagree.

---

## What this is

An internal virtual stock trading competition. Next.js 16 App Router, React 19,
TypeScript, Prisma over SQLite locally and PostgreSQL when deployed.

`cd` into this directory for everything. The repository is
`continental-vito/tradingsg` (public); the folder above this one is not a repo.

---

## Commands

```bash
make ci             # THE gate: fmt-check, lint, typecheck, test, invariants, build
make dev            # http://localhost:3000
make db-reset       # drop, re-migrate, reseed
make db-migrate     # after a schema change
make db-clear-demo  # delete every isDemo row and nothing else
make worker         # scheduled jobs, locally
make job NAME=…     # one job, once
make hooks          # once per clone — installs the pre-push CI gate
```

**`make ci` is the source of truth for whether something compiles.** Run it,
read it, fix it. Never claim a build works because it looks right.

Unlike the other projects in this workspace, this repo is **public**, so
`.github/workflows/ci.yml` exists and is free — Linux runners, no 10x macOS
multiplier. It runs the same stages. The local run is still what gates a push.

There is no `build/ci-annotate.py` and there must not be one. It parses Swift
compiler output; `tsc`, ESLint and Vitest emit GitHub annotations natively.

---

## Toolchain versions are pinned, and two of them are pinned _backwards_

Both were found by `make ci` failing loudly, and both will look like mistakes to
anyone who checks npm for "latest":

- **TypeScript is pinned to 6.0.3, not 7.x.** `typescript-eslint` refuses to
  load against the TS 7 API and throws `typescript-eslint does not support TS
7.0` at config load — so ESLint does not run at all, rather than running
  badly. Revisit when typescript-eslint ships TS 7 support.
- **ESLint is pinned to 9.39.5, not 10.x.** The `eslint-plugin-react` that
  `eslint-config-next` depends on calls the pre-10 rule-context API and dies
  with `contextOrFilename.getFilename is not a function`.

`prisma` and `@prisma/client` must stay on the **same** version (7.10.0). The
`prisma` package's `latest` dist-tag currently points at an 8.0 release
candidate, so `npm install prisma@latest` silently splits the pair.

---

## Architecture, in one screen

```
  browser
     │  server actions (thin: parse → authorise → call domain → revalidate)
     ▼
  src/server/          ← ALL domain logic. Never imported by a client component.
     ├── money.ts              the only place cents/shares/ppm are converted
     ├── portfolio/            valuation, returns, rebalance planning, invariants
     ├── leaderboard/          ranking and snapshots
     ├── reports/              weekly report generation and rendering
     ├── market/   ─┐
     ├── email/    ─┤          provider adapters, one file per provider
     └── jobs/      │          scheduled work: CLI, cron worker, HTTP
                    ▼
              Prisma ── SQLite (local) / PostgreSQL (deployed)
```

### Everything replaceable is behind an interface

| Interface            | Implementations       | Where                |
| -------------------- | --------------------- | -------------------- |
| `MarketDataProvider` | mock, Finnhub         | `src/server/market/` |
| `EmailProvider`      | console, SMTP, Resend | `src/server/email/`  |

**No provider name appears outside its own adapter file.** `build/check-scripts.sh`
greps for `finnhub`, `resend` and `nodemailer` across `src/` and fails CI on a
hit anywhere else. Keep it that way — the seam is the only reason swapping a
provider is a config change rather than a project.

---

## Rules that are load-bearing

### Money is never a float

Every monetary column is `BigInt` cents. Every share count is `BigInt`
micro-shares (1 share = 1_000_000). Every ratio is `Int` parts per million
(+7.43% is 74_300 ppm). `build/check-scripts.sh` fails CI on a `Float` column.

`src/server/money.ts` is the **only** place these units are converted. Nothing
else may multiply or divide a cents value.

### The rounding rule, stated once

> Market value and sale proceeds **floor**. Purchase cost and fees **ceil**.
> Reported ratios round **half-away-from-zero**. Nothing else rounds.

The asymmetry is directional on purpose: every rounding decision costs the
participant at most a cent and never pays them, so a buy immediately followed by
a sell at the same price can never gain. Rounding cannot be farmed.

`marketValue` is used **both** to value a holding and to compute sale proceeds.
If those ever use different rounding, fully liquidating a position moves the
portfolio's value for free — which surfaces three weeks later as an unexplained
leaderboard position, not as a test failure.

### The reconciliation invariant

`cashCents == Σ Transaction.cashDeltaCents`, exactly, for every portfolio. Plus
`totalValue - initialCapital - netFlow == realizedPnl + unrealizedPnl`.

Both are pure integer identities, so they are exact rather than approximate.
They run inside every write transaction; a violation rolls the whole rebalance
back. A bug in the rebalancer may corrupt a preview — it must never corrupt the
ledger.

### `initialCapitalCents` is immutable

Total return is `currentValue / initialCapital - 1`, which is only truthful
while the denominator cannot move. No admin action changes it. A correction
writes an `ADJUSTMENT_*` transaction and sets `adjustedByAdmin`.

This is also why the schema carries `netFlowCents` and `twrPpm` even though both
are zero today: the day someone credits a participant, the ranking must already
be correct rather than requiring a formula change under pressure.

### Ownership is checked in the query that finds the row

`requireOwnedPortfolio` filters by the caller's user id **inside** the `where`.
A missing portfolio and someone else's portfolio both return **404**, never 403
— a 403 confirms the id exists, which is exactly the fact being withheld.

Layout guards are a convenience, not the boundary: a server action is reachable
by POST without the layout ever rendering. Every action re-checks.

### Dates have two kinds and are never conflated

`...At` columns are UTC instants. `tradeDate`, `asOfDate`, `periodStartDate` are
`"YYYY-MM-DD"` strings computed in the competition's timezone, via
`src/lib/dates.ts`. Never `new Date().toISOString().slice(0, 10)` — a European
close at 22:00 local is the next UTC day in summer and the same one in winter,
which is how a weekly report ends up covering six days twice a year.

### The schema stays portable

No native enums (SQLite has none), no `@db.` annotations. Enum-like columns are
`String` with a Zod union in `src/lib/enums.ts` validating at every boundary.
`build/check-scripts.sh` enforces both.

### Error messages are UI

Every message a participant can see names the next action. No status codes, no
provider names, no type names.

> "Your allocations add up to 103%. Reduce by 3% before confirming."
> not "VALIDATION_ERROR: weights"

### Secrets live in the environment

`.env` is gitignored; `.env.example` is the committed template and documents
what breaks without each variable. `check-scripts.sh` greps for hard-coded
credentials and fails CI on a hit, and asserts every variable read by
`src/lib/env.ts` appears in the template.

---

## Demo data

Every seeded row carries `isDemo = true`, and `make db-clear-demo` deletes
exactly that set. That flag is what makes shipping the seed a reversible
decision rather than a permanent one. Keep setting it on anything the seed
writes.

---

## Tests

Vitest, against a real SQLite file rather than mocks — the things most worth
testing here are unique indexes and integer identities, and a mock has neither.

Each test's name says which real failure it guards:

- **`money.test.ts`** — that a buy-then-sell round trip can never create money,
  that `divRound` is symmetric around zero (truncation would bias every negative
  return upward), and that largest-remainder weights sum to exactly 100%.
- **`dates.test.ts`** — that a 22:30 UTC close files under the right trade date
  in Berlin, that DST does not add or drop a day, and that ISO week 53 does not
  make January's first report overwrite December's last.

---

## Working on this

Branch `dev`, keep it green, `make ci` before every push (the hook enforces it),
merge to `main` and tag to release. Commit or push only when asked — except that
finishing a piece of work means building it, committing it, and pushing to `dev`.
