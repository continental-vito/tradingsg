# How a price becomes a leaderboard position

Six steps, each writing a row the next one reads. Nothing downstream recomputes
what an earlier step committed — that is the whole design, and it is why the
dashboard, the leaderboard and the weekly email cannot disagree.

```
MarketDataProvider ──▶ PriceHistory ──▶ PortfolioValuation ──▶ LeaderboardSnapshot ──▶ WeeklyReport
   (mock | finnhub)      immutable          + HoldingValuation      + entries              + frozen HTML
```

## 1. Prices arrive

`src/server/market/` — a `MarketDataProvider` returns quotes and daily bars. The
default is a deterministic synthetic market: prices are a pure function of
`(seed, symbol, date)`, so re-running a backfill is byte-identical and a
valuation computed today still holds next month.

Each day's move is a shared market component plus an idiosyncratic one, scaled
by a per-stock beta. Independent random walks would give thirty participants
thirty uncorrelated portfolios that converge on the same return, which ranks
people by noise rather than by judgement.

Bars are upserted on `(stockId, tradeDate, revision)`. Running the backfill ten
times writes the same rows ten times.

## 2. Portfolios are valued

`src/server/portfolio/value.ts`, driven by `src/server/jobs/valuations.ts`.

Reads only `PriceHistory`, never a live quote. Price resolution is a ladder, and
it never gives up:

1. a close on exactly this date → `CLOSE`
2. the most recent close before it → `CARRY_FORWARD` (weekends, holidays, halts)
3. the same, but past the staleness limit → flagged `DEGRADED`
4. no history at all → the holding's own cost basis → `PARTIAL`

**A missing price is never zero and the position is never dropped.** Both
fabricate a −100% loss on that holding and silently rank someone last for a data
problem that is not theirs.

The result is a `PortfolioValuation` plus one `HoldingValuation` per position, so
the donut chart, the best/worst holding and the weekly report are all reads
rather than re-derivations.

## 3. Returns are computed

Total return is `currentValue / initialCapital − 1`, which is exact here because
there are no external flows: every participant is funded once and nothing is
ever added.

`twrPpm` (chain-linked, time-weighted) is stored alongside it and is identical
while `netFlowCents` is zero — a test asserts that on every valuation. It exists
so that the day an admin credits someone, the leaderboard is already correct
rather than needing a formula change under pressure.

## 4. Participants are ranked

`src/server/leaderboard/rank.ts`, driven by `src/server/jobs/leaderboard.ts`.

Reads the stored valuations. Equal returns share a rank (1, 2, 2, 4); a separate
`displayOrder` gives a strict total order so a redraw never reshuffles equal rows.
Ties break by fewer transactions, then earlier activation, then id.

A participant who has not invested holds 100% cash and is therefore exactly flat.
They are listed **after** everyone ranked, not at 0% mid-table — ranking them
there would put them ahead of everyone who is down, and reward not playing.

## 5. Trades are planned and committed

`src/server/portfolio/rebalance.ts` is a pure function: no database, no clock.
That is what lets the preview and the commit run the same code over the same
frozen quotes, so what a participant confirms is what executes.

Sells run before buys, so the cash exists — no margin, no intermediate negative
balance, no simultaneous system to solve. Constraints are validated against the
**projected end state**, not the request: floor rounding means a request for
exactly 25% lands at 24.97%, and validating the input would both admit plans
that breach the cap and reject ones that do not.

`src/server/portfolio/commit.ts` writes the ledger and asserts every invariant
**inside** the transaction. A bug in the planner can corrupt a preview; it must
never corrupt the ledger.

## 6. The report is built and sent

`src/server/reports/`. The whole personalised email — leaderboard table included,
recipient's own row highlighted — is rendered at build time and stored on
`WeeklyReportEntry.renderedHtml`.

Preview, test send and real send all read that one column. A test send at 07:00
and the real send at 08:00 are byte-identical even though prices moved in
between, which is the correct semantics for a report about _last week_. Drift is
structurally impossible rather than merely unlikely.

`EmailLog.dedupeKey` is unique, and the row is written **before** the send is
attempted. A crash between the two loses one email; the other order sends it
twice.

---

## Where the invariants live

| Invariant                                      | Enforced by                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| Cash equals the sum of the ledger              | `checkPortfolioInvariants` (A), inside every write transaction   |
| `value − capital = realised + unrealised`      | `assertPnlIdentity`, in the valuation job                        |
| No ledger row lost                             | `@@unique([portfolioId, sequence])` + a count check (I)          |
| A closed position carries no basis             | the full-liquidation short-circuit, checked by (F)               |
| One change per period                          | `@@unique([portfolioId, periodKey])` — the database, not a count |
| A submission cannot trade twice                | `@@unique` on `RebalanceRequest.idempotencyKey`                  |
| A job cannot run twice at once                 | `@@unique([jobName, runKey])` on `JobRun`                        |
| An email cannot be sent twice                  | `@@unique` on `EmailLog.dedupeKey`                               |
| A participant reaches only their own portfolio | `findOwnedPortfolio`, filtered in the `where`                    |

Every one of these is a database constraint or an exact integer identity, not an
application-level check that a concurrent request can lose the race to.
