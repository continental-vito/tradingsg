# TradingSG

An internal virtual stock trading competition. Employees get €100,000 of virtual
capital, build a portfolio from an admin-configured universe, and compete on a
leaderboard ranked by percentage return.

**No real money is involved and nothing in it is investment advice.**

---

## What it does

- **Participants** register, read a short onboarding, allocate their capital
  across stocks with sliders and percentage inputs, rebalance under
  admin-configured trading rules, and watch their position on the leaderboard.
- **Admins** create and run the competition, configure every rule, manage
  participants and the stock universe, read live analytics, and send a weekly
  HTML performance report.
- **Every number is computed server-side** from a stored price history, so a
  chart drawn tomorrow shows the same past it showed today, and the frontend
  never computes an authoritative figure.

## Quick start

```bash
cp .env.example .env          # the defaults work as-is: SQLite, mock prices, emails to disk
make install
make hooks                    # once per clone — installs the pre-push CI gate
make db-reset                 # apply migrations and seed the demo competition
make dev                      # http://localhost:3000
```

The seed prints the demo credentials. By default:

| Role        | Email                     | Password    |
| ----------- | ------------------------- | ----------- |
| Admin       | `admin@example.com`       | `admin1234` |
| Participant | `sarah.weber@example.com` | `demo1234`  |

Everything the seed writes carries `isDemo = true`. `make db-clear-demo` deletes
exactly those rows and nothing else.

## The tasks

```bash
make ci             # THE gate: fmt-check, lint, typecheck, test, invariants, build
make dev            # development server
make test           # the test suite
make db-migrate     # create and apply a migration after a schema change
make db-reset       # drop, re-migrate, reseed
make db-seed        # (re)write the demo data
make db-clear-demo  # remove every demo row
make db-studio      # browse the database
make worker         # run the scheduled jobs locally
make job NAME=…     # run one job once
make hooks          # install the pre-push CI gate
make help           # every target
```

`make ci` is the source of truth for whether this compiles and passes. There is
also a GitHub Actions workflow running the same stages — this repo is public, so
Linux runner minutes are free — but the local run is what gates a push.

## Layout

| Path                                      | What it is                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------- |
| `prisma/schema.prisma`                    | The database. Written to generate identically on SQLite and PostgreSQL.          |
| `prisma/seed.ts`, `prisma/demo/`          | The demo competition, stocks and participants.                                   |
| `src/app/(public)/`                       | Landing page, sign-up, sign-in, password reset.                                  |
| `src/app/(participant)/`                  | Onboarding, allocation, dashboard, holdings, leaderboard.                        |
| `src/app/(admin)/`                        | Competition, participants, stocks, reports, analytics.                           |
| `src/app/actions/`                        | Server actions. Thin: parse, authorise, call the domain, revalidate.             |
| `src/server/`                             | All domain logic. Never imported by a client component.                          |
| `src/server/money.ts`                     | The only place monetary units are converted.                                     |
| `src/server/market/`, `src/server/email/` | Provider adapters. A provider's name appears in one file.                        |
| `src/server/jobs/`                        | Scheduled work, with a CLI, a cron worker and an HTTP entry point.               |
| `src/components/`                         | Presentational only. No business logic, no money maths.                          |
| `build/`                                  | `ci.sh`-equivalent make targets, repository invariant checks, the pre-push hook. |

## Documentation

| Document               | Covers                                                        |
| ---------------------- | ------------------------------------------------------------- |
| `CLAUDE.md`            | Commands, architecture, and the rules that are load-bearing.  |
| `docs/architecture.md` | How a price becomes a leaderboard position.                   |
| `docs/deployment.md`   | Moving from SQLite to PostgreSQL, and the Vercel cron wiring. |
| `docs/limitations.md`  | What is deliberately not built.                               |

## Requirements

Node 22 or newer. No database daemon: development and the test suite run against
a local SQLite file. Deployment needs PostgreSQL — see `docs/deployment.md`.
