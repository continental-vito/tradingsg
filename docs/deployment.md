# Deployment

Local development runs on SQLite with no daemon. **Anything deployed needs
PostgreSQL** — Vercel's filesystem is ephemeral and read-only, so a SQLite file
there is lost on every deployment and cannot be written to in between.

## Switching to PostgreSQL

The schema is written to be dialect-portable: money is integer cents, enum-like
columns are `String` with a Zod union, and there are no `@db.` annotations.
`build/check-scripts.sh` fails CI if any of that regresses. So the switch is
genuinely two lines plus a fresh migration:

```bash
make db-provider-postgres
npm install @prisma/adapter-pg
# set DATABASE_URL in .env / the Vercel dashboard to the Postgres connection string
rm -rf prisma/migrations
npx prisma migrate dev --name init
```

Step 3 discards the SQLite migration history on purpose. A migration file is
dialect-specific SQL and cannot be replayed against the other engine; keeping
both would mean maintaining two histories that must never diverge.

### What is and is not tested

`build/check-scripts.sh` asserts the schema _stays_ portable, and CI generates
the client. **The PostgreSQL migration set has not been run against a live
PostgreSQL database.** It will need one round of "apply it and read the error"
the first time. That is stated plainly here rather than implied to be routine.

## Vercel

`vercel.json` declares the cron schedule. On Vercel the jobs are not run by a
long-lived process — serverless has none — they are HTTP calls to
`/api/cron/<job>` carrying `Authorization: Bearer $CRON_SECRET`.

Set these in the Vercel project:

| Variable               | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`         | the PostgreSQL connection string                              |
| `APP_URL`              | the deployed origin, so email links do not point at localhost |
| `CRON_SECRET`          | `openssl rand -base64 32`                                     |
| `COMPANY_NAME`         | the company's name                                            |
| `MARKET_DATA_PROVIDER` | `finnhub`, with `FINNHUB_API_KEY`                             |
| `EMAIL_PROVIDER`       | `resend` with `RESEND_API_KEY`, or `smtp` with `SMTP_*`       |

**Without `CRON_SECRET` the cron routes return 404 rather than standing open.**
That is the intended failure: an unauthenticated endpoint that regenerates every
valuation is worse than a job that does not run.

## Self-hosting instead

`make worker` runs the same jobs from a long-lived `node-cron` process. The job
implementations are identical — only the entry point differs — so a self-hosted
deployment needs no `vercel.json` and no `CRON_SECRET`, just the worker running
alongside the app.
