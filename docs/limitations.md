# What is deliberately not built

Being explicit about this is cheaper than rediscovering it during a demo.

## Not built, and not planned

- **Real money, real brokerage, real order routing.** Everything is virtual. The
  price feed is read-only and no order ever leaves the machine.
- **Short selling, margin and leverage.** `allowShort` and `allowNegativeCash`
  exist in the settings so the invariant checker has something to read, and both
  are false. Turning either on is a deliberate act, not a supported mode.
- **Dividends and corporate actions.** A split or a dividend during a competition
  will show up as a price jump attributed to performance. For a twelve-week
  internal competition that is an accepted inaccuracy; for a longer one it is not.
- **Intraday charts.** Valuations are daily closes. The 1D view interpolates
  between the previous close and the current quote rather than plotting ticks.
- **Multi-currency.** Every price is stored in the competition's currency. A
  competition mixing US and European names treats both as EUR.

## Built, with the shape worth knowing

- **Notifications are recomputed, not reacted to.** The hourly job works out
  which notifications _should_ exist right now and inserts the ones that do not.
  A missed run means a late notification, never a duplicate and never a gap. The
  dedupe key is a unique index, so a forced re-run still creates nothing.
- **Admin adjustments move cash, never starting capital.** Total return is
  measured against the grant, so an administrator who could edit that
  denominator could hand somebody a rank. An adjustment is a signed ledger row
  flagged as an external flow — excluded from the return rather than counted as
  performance — and it badges the participant, because their return is no longer
  comparable with the others.

## Known sharp edges

- **The PostgreSQL migration has not been run against a live database.** See
  `docs/deployment.md`.
- **Mock prices are synthetic.** They are seeded and reproducible, and they are
  shaped to give a believable spread of winners and losers — but they are not
  real market data and must never be presented as such.
- **A delisted stock has no defined policy yet.** If a name stops pricing
  mid-competition, the valuation ladder carries its last close forward
  indefinitely and flags the valuation `DEGRADED`. Force-liquidation at the last
  known close is the intended eventual behaviour.
