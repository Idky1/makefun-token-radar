# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Idky1/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Idky1/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a frozen DefiLlama snapshot (758 protocols, 2026-11-14), ranks the 198 pre-token protocols by an implied value, and gives each one a concrete farm plan.

## The model

The implied value is priced from the snapshot's own figures — never from a hardcoded list of names:

```
implied = TVL × multiple(category) × growth × maturity
```

- **multiple(category)** — the median market-cap-to-TVL ratio of the tokenized protocols in that category (a category with fewer than 5 tokenized protocols uses the global median, 0.1689×). Every multiple is clamped to 0.05–0.50.
- **growth** — 1 + (7-day TVL change, clamped to −60%…+120%) ÷ 100 × 0.5.
- **maturity** — 0.6 + min(age in days, 1095) ÷ 1095 × 0.4; unknown listing date counts as 365 days.

The board covers all 40 watchlist protocols plus every other rankable pre-token protocol — 198 rows. A protocol counts as rankable when the snapshot records no token for it and it is not a wrapped, staked or bridged product of a token that already trades, not an exchange, and not a versioned pool: the watchlist's own definition of a token that does not exist yet, applied to the whole board. The 24 largest live-token protocols are shown separately, at the market's own values, never mixed into the ranked board. Each row carries an 8-step farm plan with costs and times, derived from the protocol's category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. The run is deterministic: the same snapshot always writes the same bytes.

## The dashboard

`dashboard/` is a static page with no network: a sortable, filterable board (search, category, chain), a detail view for every protocol with the full model arithmetic and its farm plan, a separate live-token view, and a model explainer that prints the derived multiples.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0wq1c4xa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)</sub>
