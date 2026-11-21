# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Idky1/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Idky1/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a frozen DefiLlama snapshot (758 protocols, 2026-11-14), ranks the 198 pre-token protocols by an implied value, and gives each one a concrete farm plan. Every coefficient is fitted on the snapshot and tested held-out before it is kept.

## The model

```
implied = if-it-launches × token-odds
if-it-launches = 10 ^ (3.5291 + 0.4567 × log10(TVL))
token-odds = logistic(age)          # intercept 0.0503, age weight 0.8246
```

- **Value.** The size curve is fitted by least squares on the 95 traded protocols that record a listing date (R² 0.168). The multiple therefore falls as TVL rises: 0.152× at $100M, 0.044× at $1B, 0.012× at $10B. A flat category-median multiple (0.204×) is the baseline it is tested against.
- **Terms.** Category, 7-day growth, age, chain count and a placebo control are each tested in turn and kept only when they lower *both* the leave-one-out miss and the walk-forward miss (fit only on tokens listed earlier, predict each later one). Only the size curve survives: leave-one-out ×3.23 and walk-forward ×2.77, against ×5.00 and ×5.21 for the flat median. Shrunk category offsets (k=5, 10, 20) improve leave-one-out but hurt walk-forward, so they are dropped too.
- **Odds.** A logistic regression on the 645 protocols with a listing date (327 recorded a token, 51% base rate). Age is the only feature that survives the same both-ways test: leave-one-out Brier 0.217 and walk-forward 0.227, against 0.250 and 0.262 for the base rate. Size, growth and chain count are dropped; a placebo that shuffles growth across peers scores 0.218 / 0.231, so the age signal is not a fitting artefact.
- **Ranges.** A row's P25–P75 range is the leave-one-out residual distribution of the kept model (×0.31–×3.26 of the prediction). It holds 49% of the left-out tokens (stated 50%) and 52% walk-forward; the P10–P90 range holds 79% (stated 80%) and 79%. Bootstrap, 200 refits: intercept 3.529 ± 0.826, slope 0.457 ± 0.105.
- **Farm.** A plan is 0.02% of TVL (floored $50, capped $5,000) held 12 weeks; the airdrop is 7% of the implied value, shared in proportion to the plan's share of TVL; costs are $25 of gas, the 5% T-bill return on the plan for 12 weeks, and 0.2% slippage. FARM beats the T-bill after all costs (4 of 198); SKIP loses more than twice the gas cost (90); MARGINAL is the rest (104). The dashboard's sliders recompute every verdict live.

The board covers all 40 watchlist protocols plus every other rankable pre-token protocol — 198 rows. A protocol counts as rankable when the snapshot records no token for it and it is not a wrapped, staked or bridged product of a token that already trades, not an exchange, and not a versioned pool: the watchlist's own definition of a token that does not exist yet, applied to the whole board. The 24 largest live-token protocols are shown separately, at the market's own values, never mixed into the ranked board. Each row carries an 8-step farm plan with costs and times, derived from the protocol's category, chains, TVL and age. All 758 snapshot protocols are accounted for on the board: 198 ranked, 416 already record a token, 144 left out.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

`main.ts` (Node 22, standard library only) writes `out/board.json`, `out/data.js`, copies `dashboard/` and `screenshots/` to `out/`, and writes `out/dossier.json`. The run is deterministic: the same snapshot always writes the same bytes (two runs are byte-identical).

## The dashboard

`dashboard/` is a static page with no network. The board page carries the evidence itself: a KPI strip, the formula, the protocol accounting with a verification line, and the out-of-sample tables (value-model ladder, token-odds Brier ladder, range honesty). The board is sortable and filterable (Farm / Marginal / Skip tabs, tier, category, chain, search), the plan-size / drop-share / horizon sliders recompute every verdict, net and net/hour live, and CSV/JSON export the filtered rows. A detail view for every protocol shows the full model arithmetic, its farm economics and its farm plan; a separate live-token view and a model explainer complete the page.

---

<sub>Entered on [make.fun](https://make.fun/?ref=0wq1c4xa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)</sub>
