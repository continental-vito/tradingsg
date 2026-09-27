# Deployment

Local development runs on SQLite with no daemon. **Anything deployed needs
PostgreSQL** — Vercel's filesystem is ephemeral and read-only, so a SQLite file
there is lost on every deployment and cannot be written to in between.

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

## 1. Decide on the database dialect, and commit it

The Prisma schema's `provider` is genuinely build-time: it decides the SQL that
gets generated, so one build cannot serve both dialects. The deployed branch has
to be on `postgresql`.

The _driver_ is not build-time. It is chosen at runtime from `DATABASE_URL`'s
scheme, in `adapterFor()` in `src/server/prisma.ts` — so there is no source file
to edit and nothing that can disagree with the schema.

```bash
cd ~/Claude/TradingSG/tradingsg-dev
make ci-postgres        # proves the Postgres path works before you rely on it
make db-provider-postgres
rm -rf prisma/migrations
npx prisma migrate dev --name init    # needs DATABASE_URL — do this after step 3
```

Discarding the SQLite migration history is intended. A migration file is
dialect-specific SQL and cannot be replayed against the other engine; keeping
both would mean two histories that must never diverge.

### Keeping SQLite for local work

You can, but it means the deployed branch and your working branch differ by the
provider line, and every `git merge` will touch it. Unless you specifically want
offline development, it is simpler to point local dev at a Neon **branch** — Neon
branches are free, instant, and give you a real Postgres that matches production.
Then `make ci` and the deployment test the same dialect, which is the whole
argument for doing it.

---

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
npx prisma migrate dev --name init   # creates the Postgres migration and applies it
make db-seed                         # stocks, settings, and your admin account
```

`make db-seed` is idempotent — safe to run again. It creates
`admin@example.com` with the password in `prisma/seed.ts`. **Change that
password immediately after your first login**, or edit `ADMIN_PASSWORD` in the
seed before running it.

Then commit the dialect switch:

```bash
git add -A && git commit -m "Switch datasource to PostgreSQL for deployment"
git push origin dev
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

---

## 6. Scheduled jobs — read this before trusting `vercel.json`

**Vercel's Hobby plan allows two cron jobs, triggered roughly once a day.**
`vercel.json` declares nine, and several need to run far more often: prices
every 15 minutes during market hours, scheduled reports every ten. On Hobby
those schedules are not honoured and the jobs quietly do not run — no error,
just a leaderboard that never updates.

`vercel.json` is generated from the job registry, and
`build/check-scripts.sh` fails if the two disagree. That check exists because
they had already drifted: `export-backup` — the daily CSV that portfolios are
rebuilt from — and `housekeeping` were missing from `vercel.json` entirely, so a
deployment would have produced no backups at all and said nothing about it.

Three ways out:

1. **GitHub Actions (free, recommended).** `.github/workflows/scheduled-jobs.yml`
   already does this. Actions minutes are free on a public repo. Add two
   repository secrets under **Settings → Secrets and variables → Actions**:

   | Secret        | Value                                             |
   | ------------- | ------------------------------------------------- |
   | `APP_URL`     | `https://your-app.vercel.app` (no trailing slash) |
   | `CRON_SECRET` | the same value as in Vercel                       |

   Then trigger one by hand from the Actions tab (**Run workflow** → pick
   `refresh-prices`) and read the log. It prints each job's response body.

2. **Vercel Pro**, $20/month, which honours `vercel.json` as written. Then
   delete the workflow so the jobs are not driven twice. They are idempotent, so
   double-driving is harmless, but it doubles the invocations for nothing.

3. **A long-lived worker** on any always-on host: `make worker` runs the same
   job implementations under `node-cron`. No `vercel.json`, no `CRON_SECRET`.

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
