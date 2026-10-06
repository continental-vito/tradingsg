# Deployment

PostgreSQL everywhere: development, the test suite and production all run the
same engine. This used to be SQLite locally and PostgreSQL when deployed, which
meant every dialect difference stayed invisible until it reached the hosted
database — and that the one thing never exercised was the thing production
depended on.

Locally that costs nothing to set up: `make dev-db` starts PGlite, which is
PostgreSQL 18 compiled to WASM, with no Docker and no install.

This document is a runbook. Follow it top to bottom.

**Two steps need you personally**, because they are browser logins that cannot
be scripted: creating the Neon database (step 2) and importing the project into
Vercel (step 4). Everything else is a command.

**Nothing in here should be pasted into a chat window.** The database URL
contains a password. It belongs in the Vercel dashboard and in your local
`.env`, which is gitignored.

---

## 0. What you are deploying onto

| Piece          | Choice                     | Cost for ~100 participants                                                          |
| -------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| Hosting        | Vercel                     | Free (Hobby) is enough for the app                                                  |
| Database       | Neon PostgreSQL            | Free tier is enough — see below                                                     |
| Scheduled jobs | GitHub Actions             | Free on a public repo. **Vercel Hobby cannot run this app's schedule** — see step 6 |
| Market data    | Yahoo (default) or Finnhub | Free                                                                                |
| Email          | Resend or your own SMTP    | Resend's free tier is 100/day, 3,000/month                                          |

On the database size: 100 participants, one valuation each per day, plus per
holding, comes to roughly 40 MB after a three-month competition. Neon's free
tier gives 0.5 GB. There is a lot of headroom.

Email is the one thing that can bite. A weekly report to 100 people is 100
messages — inside Resend's monthly free allowance, but over its 100/day limit
only if you also send a test run the same day. Send the test to yourself.

---

## 1. Check the Postgres path before relying on it

```bash
cd ~/Claude/TradingSG/tradingsg-dev
make ci            # the whole suite, on real PostgreSQL
make ci-postgres   # the DDL that `migrate deploy` will apply, over a real wire connection
```

There is no dialect to switch: `prisma/schema.prisma` is already on
`postgresql`, and `prisma/migrations/` holds the PostgreSQL migration set that
both the tests and the deployment apply. The driver is chosen from
`DATABASE_URL`'s scheme at runtime, in `adapterFor()` in
`src/server/prisma.ts`, so there is no second place that has to agree.

## 2. Create the database — _you do this one_

Browser login, so it has to be you.

1. Go to <https://neon.tech> and sign in with GitHub.
2. Create a project. Region: pick the one nearest your users (`eu-central-1`
   for Europe). Postgres version: the default.
3. On the project dashboard, open **Connection string** and copy **both**:
   - the **pooled** string — the host contains `-pooler`
   - the **direct** string — untick "Connection pooling"

You need both, and they are not interchangeable:

| Use                                  | Which string | Why                                                                                                                                                                                 |
| ------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The running app (`DATABASE_URL`)     | **pooled**   | Each serverless invocation is its own process. Without a pooler in front, a few hundred concurrent invocations each open a connection and Postgres starts refusing them             |
| Migrations (`prisma migrate deploy`) | **direct**   | Prisma's migration engine takes a session-level advisory lock, which a transaction pooler does not carry across statements. Against the pooled URL it fails or, worse, half-applies |

Both must end with `?sslmode=require`.

---

## 3. Point your local checkout at it, and migrate

```bash
# In .env — gitignored. Use the DIRECT string here, because this is what runs
# migrations. Do not commit this file and do not paste it anywhere.
DATABASE_URL="postgres://…  (direct)  …?sslmode=require"
```

```bash
npx prisma migrate deploy    # applies the committed migration set
make db-seed                 # stocks, settings, and your admin account
```

`migrate deploy`, not `migrate dev`: the migration set is already committed, and
`dev` would try to author a new one and wants a shadow database to do it.

`make db-seed` is idempotent — safe to run again. It creates
`admin@example.com` with the password in `prisma/seed.ts`. **Change that
password immediately after your first login**, or edit `ADMIN_PASSWORD` in the
seed before running it.

Seeding fills the competition with ~25 demo participants so no screen is empty.
Before real people register, clear them:

```bash
make db-clear-demo   # deletes exactly the rows the seed created, and nothing else
```

---

## 4. Import the project into Vercel — _you do this one too_

Browser login again.

1. Go to <https://vercel.com/new> and sign in with GitHub.
2. Import `continental-vito/tradingsg`.
3. Framework preset: **Next.js** (detected). Build command, output directory and
   install command: leave every one at the default.
4. Production branch: **main**. Vercel defaults to your repo's default branch,
   which is what you want — `dev` deployments then arrive as previews.
5. Before the first deploy, add the environment variables in step 5. A deploy
   without `DATABASE_URL` fails at build time with a clear error, so if you
   forget, add them and redeploy.

---

## 5. Environment variables

Vercel project → **Settings → Environment Variables**. Set each for
**Production** and **Preview**.

| Variable               | Value                                  | Without it                                                                                                                                   |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`         | Neon **pooled** string                 | Nothing works                                                                                                                                |
| `APP_URL`              | `https://your-app.vercel.app`          | Email links point at localhost                                                                                                               |
| `CRON_SECRET`          | `openssl rand -base64 32`              | **The cron routes return 404.** Intended: an unauthenticated endpoint that regenerates every valuation is worse than a job that does not run |
| `COMPANY_NAME`         | your company's name                    | Falls back to a placeholder                                                                                                                  |
| `MARKET_DATA_PROVIDER` | `yahoo`                                | Defaults to the mock generator — plausible but invented prices                                                                               |
| `EMAIL_PROVIDER`       | `resend`                               | Defaults to `console`, which writes files a serverless filesystem discards                                                                   |
| `RESEND_API_KEY`       | from the Resend dashboard              | Required by `resend`                                                                                                                         |
| `EMAIL_FROM`           | `TradingSG <no-reply@yourcompany.com>` | Defaults to an `example.com` address, which most providers reject                                                                            |

Generate the cron secret locally and paste it straight into the dashboard:

```bash
openssl rand -base64 32   # CRON_SECRET
```

There is no session secret to set. Sessions are opaque 32-byte random tokens
stored as a SHA-256 hash, so there is nothing to sign — see
`src/server/auth/session.ts`.

For SMTP instead of Resend, set `EMAIL_PROVIDER=smtp` plus `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. The sender address is `EMAIL_FROM`
either way.

`MARKET_DATA_PROVIDER` accepts `mock`, `yahoo` or `finnhub`; `finnhub` also
needs `FINNHUB_API_KEY`. `EMAIL_PROVIDER` accepts `console`, `smtp` or
`resend`.

### Run the migration against production

Vercel's build does not migrate, deliberately: a build that silently alters the
production schema is how a bad deploy becomes unrecoverable. Run it yourself,
against the **direct** URL:

```bash
DATABASE_URL="…direct…" npx prisma migrate deploy
```

Do this once before the first deploy, and after any schema change.

### Authoring a new migration later

`prisma migrate dev` needs a shadow database and a second connection, which the
local PGlite server cannot provide. Author migrations against a **Neon branch**
instead — they are free and instant:

```bash
# Neon dashboard → Branches → New branch, then:
DATABASE_URL="…the branch's direct URL…" npx prisma migrate dev --name add_something
```

Commit the generated directory. The test suite applies every migration in
`prisma/migrations/` in order, so a new one is covered automatically.

---

## Function region — keep it next to the database

`vercel.json` pins functions to **`fra1` (Frankfurt)** because the Neon database
is in `eu-central-1`. Vercel's default is `iad1` (Washington), which put every
query across the Atlantic — about 90 ms per round trip, several per page — and
made navigation feel unresponsive. If the database ever moves, move this with
it; a region far from the database costs more than any code optimisation wins.

## 6. Scheduled jobs — two daily Vercel Crons

Everything updates **once a day, after the market close**. `vercel.json`
declares two crons, each firing a chain from `src/server/jobs/chains.ts`:

| Cron                | When (UTC, ±1 h) | Runs, in order                                                             |
| ------------------- | ---------------- | -------------------------------------------------------------------------- |
| `/api/cron/nightly` | 20:00            | refresh-prices → close-prices → snapshot-valuations → leaderboard → backup |
| `/api/cron/morning` | 04:00            | run-notifications → housekeeping → build-weekly-report (once a week)       |

20:00 UTC is 22:00 in Berlin in summer and 21:00 in winter — after the XETRA
close, and still the same Berlin day, so the close being valued is today's.
Hobby crons fire somewhere within the hour; both chains are idempotent and
backfill any missed day, so the exact minute does not matter.

Vercel sends `Authorization: Bearer $CRON_SECRET` with each cron call by
itself, so `CRON_SECRET` must be set in the Vercel project — without it the
cron routes 404 by design.

**Hobby limits that shape this:** at most two crons, daily only. A sub-daily
expression does not run less often — Vercel refuses the whole deployment:

```
Error: Hobby accounts are limited to daily cron jobs. This cron expression
(*/15 8-22 * * 1-5) would run more than once per day.
```

`build/check-schedule.py` fails CI on a sub-daily or third cron, on a cron
that names no chain, and on any registered job no chain runs.

### Why not GitHub Actions any more

This used to be a GitHub Actions workflow on a `*/15` schedule. GitHub treats
schedules as best effort and fired it only every four to six hours, so the jobs
waiting for a 15-minute evening window never ran: prices, valuations and the
leaderboard froze with no failed run to show for it.

`.github/workflows/scheduled-jobs.yml` remains for **manual** runs — Actions →
Scheduled jobs → Run workflow → pick `nightly` or any single job. It needs two
repository secrets:

| Secret        | Value                         |
| ------------- | ----------------------------- |
| `APP_URL`     | `https://your-app.vercel.app` |
| `CRON_SECRET` | the same value as in Vercel   |

### Self-hosting instead

`make worker` runs the same job implementations under a long-lived `node-cron`
process, on each job's own `cron` cadence in `src/server/jobs/registry.ts`.
No Vercel Cron, no `CRON_SECRET`, no Actions.

---

## 7. Verify the deployment

In this order, because each step depends on the last.

```bash
# 1. It is up, and the database answers.
curl -sS -o /dev/null -w '%{http_code}\n' https://your-app.vercel.app/          # 200
curl -sS -o /dev/null -w '%{http_code}\n' https://your-app.vercel.app/login     # 200

# 2. The cron secret matches. 200 = ran; 404 = the secret is wrong or unset.
curl -sS -X POST -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/refresh-prices

# 3. It refuses an unauthenticated call.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  https://your-app.vercel.app/api/cron/refresh-prices                           # 404
```

Then in the browser:

1. Log in as the admin account and change its password.
2. **Admin → Stocks** — prices are populated and today's date is on them.
3. **Admin → Settings** — set the competition dates, the starting capital, and
   whether shorting is allowed.
4. Register a second account, build a portfolio, and confirm it appears on the
   leaderboard after you run `snapshot-valuations` by hand.
5. **Admin → Reports** — generate a weekly report, use **Send test to me**, and
   read the email that arrives. Do this before the first real send.
6. **Admin → Backups** — download today's CSVs. This is your recovery path; the
   time to find out it works is now, not during the competition.

---

## What is tested, and what is not

`make ci-postgres` starts a real PostgreSQL 18 (PGlite over a TCP socket — no
Docker, no account) and asserts that the generated DDL applies, that BigInt
money survives a round trip beyond 2^53, that a unique index rejects a
duplicate, and that a transaction commits. `build/check-scripts.sh` fails CI if
the schema stops being dialect-portable.

**Not covered:** Neon's pooled endpoint under real concurrency, and
`prisma migrate deploy` against a hosted Neon database. Both are exercised the
first time you run step 5, and the failure mode to expect is a connection or
advisory-lock error — which is the reason the pooled/direct distinction in step 2
is spelled out rather than left as a footnote.

---

## Rolling back

Vercel keeps every previous deployment. **Deployments → … → Promote to
Production** puts an earlier build back in seconds.

That reverts code, not data. A migration that dropped a column is not undone by
promoting an older build — restore from the daily CSVs under **Admin → Backups**,
or from a Neon branch taken before the migration. Take one before any migration
that drops or renames anything:

```bash
# In the Neon dashboard: Branches → New branch → from the current head.
```
