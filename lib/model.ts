// Token Radar v2: implied values from a fitted size curve and token odds, both validated held-out.
//
// The board ranks every rankable protocol in the snapshot: pre-token, and not a wrapped,
// staked or bridged product of a token that already trades, not an exchange, not a versioned
// pool — the watchlist's own definition of a token that does not exist yet, applied to the
// whole board. That is the whole watchlist (the floor, never a ceiling) plus every rankable
// protocol below the floor and every rankable one above it the watchlist leaves out.
//
// Implied value follows only from the snapshot's own figures, and every coefficient is fitted
// on the snapshot and tested held-out before it is kept:
//
//   VALUE — log10(mcap) = a + b x log10(tvl), fitted by least squares on the traded protocols
//   that record a listing date (n = 95). The multiple therefore falls as TVL rises: 0.15x at
//   $100M TVL, 0.044x at $1B, 0.012x at $10B. A flat category-median multiple is the baseline
//   it is tested against, and category, 7-day growth, age, chain count and a placebo control
//   are each tested in turn and kept only when they lower BOTH the leave-one-out miss and the
//   walk-forward miss (fit only on tokens listed earlier, predict each later one). On this
//   snapshot only the size curve survives: LOO x3.23 and walk-forward x2.77, against x5.00 and
//   x5.21 for the flat median. The P25-P75 range of a row is the leave-one-out residual
//   distribution of the kept model, so the stated 50% range holds 49% of the left-out tokens
//   (52% walk-forward) and the stated 80% range holds 79% (79% walk-forward).
//
//   ODDS — a logistic regression on the 645 protocols that record a listing date (327 of
//   them recorded a token, a 51% base rate), with age as the only feature that survives the
//   same both-ways test: LOO Brier 0.217 and walk-forward 0.227, against 0.250 and 0.262 for
//   the base rate. Size, growth and chain count are tested and dropped; a placebo (each
//   peer's growth replaced by the next peer's) scores 0.218 / 0.231, so the age signal is not
//   a fitting artefact.
//
//   implied = if-it-launches x token-odds, where if-it-launches is the size curve's prediction
//   for the protocol's TVL and token-odds is the logistic model's probability that a protocol
//   of its age records a token.
//
//   FARM — a plan is 0.02% of the protocol's TVL (floored at $50, capped at $5,000) held for
//   12 weeks; the airdrop is 10% of the implied value, shared in proportion to the plan's share
//   of TVL; costs are $25 of gas, the 5% T-bill return on the plan capital for 12 weeks, and
//   0.2% slippage. FARM means the position pays for itself and its annualised airdrop yield
//   beats the 5% T-bill; SKIP means it loses more than twice the gas cost; THIN is the
//   rest. The dashboard's sliders recompute the same arithmetic live.
//
// No protocol name is ever special-cased: the same functions score every row, and the
// dashboard prints the fitted coefficients, the held-out tables and the accounting so a
// reader can check the arithmetic.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** The farm plan's defaults: the dashboard's sliders start here and recompute from them. */
export const FARM_DEFAULTS = {
  plan_share: 0.0002, // 0.02% of TVL
  plan_floor: 50,
  plan_cap: 5000,
  drop_share: 0.1, // 10% of the implied value — observed initial user-airdrop allocations
  // cluster 5–20% of total supply (Uniswap 15%, Arbitrum 11.62%, ENS 19.6%, Optimism 5%;
  // 2023 average 20%, Stephanian & Turley, 150+ launches); 10% sits at-or-below that cluster
  horizon_weeks: 12,
  hours: 24, // 12 weeks x ~2 hours a week
  gas_usd: 25,
  tbill_rate: 0.05,
  slippage: 0.002,
  skip_loss_usd: 50, // loses more than twice the gas cost
};

/** The fitted size curve: log10(mcap) = intercept + slope x log10(tvl). */
export interface SizeCurveFit {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

/** One row of the value-model term ladder: a cumulative term set and its held-out miss. */
export interface ValueTermResult {
  label: string;
  terms: string[];
  loo: number;
  wf: number;
  loo_meanlog: number;
  wf_meanlog: number;
  wf55: number;
  wf55_meanlog: number;
  kept: boolean;
}

/** The P25-P75 and P10-P90 ranges of the kept model, and how often they hold. */
export interface RangeStats {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  loo_in_p25_p75: number;
  loo_in_p10_p90: number;
  wf_in_p25_p75: number;
  wf_in_p10_p90: number;
  wf_n: number;
  within_x3_loo: number;
  within_x3_wf: number;
}

/** The bootstrap standard errors of the size-curve coefficients (200 refits). */
export interface BootstrapStats {
  refits: number;
  intercept_se: number;
  slope_se: number;
  multiple_100m: number;
  multiple_100m_se: number;
}

/**
 * A nested term-selection check: the term/feature set is re-picked inside each split, and the
 * fixed (full-data) set is scored against the re-picked set on the same held-out rows, both
 * fitted on the split's train part only. A kept set that only wins because it was picked on
 * the rows it is scored on would show up here as the re-picked set beating the fixed set.
 * five_fold: a seeded 5-fold split (mulberry32 seed 20261125) over the listing-date order;
 * wf: one time split, train on the earliest 60% listed, test on the latest 40%. Value scores
 * are median miss (×), odds scores are mean Brier. Picks are the re-picked kept sets, as
 * '+'-joined labels ('flat' when the flat median / base rate wins).
 */
export interface NestedCheck {
  five_fold_fixed: number;
  five_fold_repicked: number;
  five_fold_picks: string[];
  wf_fixed: number;
  wf_repicked: number;
  wf_pick: string;
}

/** Everything the value model fitted and validated, for the dashboard's evidence tables. */
export interface ValueModel {
  fit: SizeCurveFit;
  flat_median: number;
  multiple_100m: number;
  multiple_1b: number;
  multiple_10b: number;
  terms: ValueTermResult[];
  kept_terms: string[];
  kept_shrink: number;
  shrunk_category: { shrink: number; loo: number; wf: number; loo_meanlog: number; wf_meanlog: number; wf55: number; wf55_meanlog: number; kept: boolean }[];
  category_offsets_64: { category: string; n: number; offset: number }[];
  ranges: RangeStats;
  bootstrap: BootstrapStats;
  /** The nested term-selection check (re-picked inside each split): set by buildBoard, not by the fit. */
  nested?: NestedCheck;
}

/** One row of the token-odds term ladder: a cumulative feature set and its held-out Brier. */
export interface OddsTermResult {
  label: string;
  features: number[];
  loo: number;
  wf: number;
  kept: boolean;
}

/** Everything the token-odds model fitted and validated. */
export interface OddsModel {
  weights: number[];
  use: number[];
  base_rate: number;
  peers: number;
  recorded: number;
  brier_loo: number;
  brier_wf: number;
  base_brier_loo: number;
  base_brier_wf: number;
  terms: OddsTermResult[];
  placebo_loo: number;
  placebo_wf: number;
  family_rates: Record<string, number>;
  called_right_loo: number;
  called_right_wf: number;
  growth_se: number;
  growth_mean: number;
  growth_per_unit: number;
  growth_per_unit_se: number;
  /** The nested term-selection check (re-picked inside each split): set by buildBoard, not by the fit. */
  nested?: NestedCheck;
}

/** The whole snapshot's accounting: every protocol in exactly one group. */
export interface Accounting {
  ranked_watchlist: number;
  ranked_early: number;
  token_priced: number;
  token_no_cap: number;
  out_category: number;
  out_versioned: number;
  out_wrapped: number;
  out_exchange: number;
  out_other: number;
  total: number;
}

/** A farm position's economics under the plan defaults. */
export interface FarmEconomics {
  plan: number;
  gross: number;
  costs: number;
  net: number;
  net_per_hour: number;
  ann_yield: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  if_launch_usd: number;
  token_odds: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  model: {
    size_multiple: number;
    size_intercept: number;
    size_slope: number;
    odds_intercept: number;
    odds_age_weight: number;
    age_years: number;
    family: string;
    family_rate: number;
    /** The odds-ratio contributions of this row's age and growth vs the peer mean: exp(w·z). ×age > 1 means older than average; ×growth < 1 means faster-growing than average. */
    factor_age: number;
    factor_growth: number;
  };
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the farm plan carried whole. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  if_launch_usd: number;
  token_odds: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  size_multiple: number;
  family: string;
  family_rate: number;
  factor_age: number;
  factor_growth: number;
  farm: FarmEconomics;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the models it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** The market index for the 7D column: the median 7D TVL change across the ranked rows that report one (196 of 198). A row's "vs market" is its own 7D minus this. */
  market_7d: number;
  value: ValueModel;
  odds: OddsModel;
  accounting: Accounting;
  farm: { farm: number; thin: number; skip: number };
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const log10 = (x: number): number => Math.log10(x);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or `fallback` when it is empty. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A quantile by linear interpolation on the sorted values, matching the analysis script. */
function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A seeded PRNG (mulberry32) so the bootstrap is deterministic across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Least squares by the normal equations and Gaussian elimination with partial pivoting.
 * `X` is the list of feature rows (the caller adds the intercept column); `y` the targets.
 * Returns the coefficients, or null when the system is singular.
 */
function ols(X: number[][], y: number[]): number[] | null {
  const n = X.length;
  const k = X[0]!.length;
  const A: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r]![i]! * X[r]![j]!;
      row.push(s);
    }
    A.push(row);
  }
  const b: number[] = [];
  for (let i = 0; i < k; i++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r]![i]! * y[r]!;
    b.push(s);
  }
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[piv]![c]!)) piv = r;
    const tmp = M[c]!;
    M[c] = M[piv]!;
    M[piv] = tmp;
    if (Math.abs(M[c]![c]!) < 1e-12) return null;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let cc = c; cc <= k; cc++) M[r]![cc] = M[r]![cc]! - f * M[c]![cc]!;
    }
  }
  return M.map((row, i) => row[k]! / row[i]!);
}

/** The sample standard deviation (one degree of freedom), or 0 when it is empty. */
function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) * (v - m), 0) / (values.length - 1));
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The categories the watchlist itself leaves out: a bridge moves a token that already trades, a
 * liquid-staking or restaking product is a staked form of one, and an exchange's token already
 * trades. None of them is a protocol still waiting on a launch of its own.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a product of a token that trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name beginning with an exchange's name is that exchange's product, not a new protocol. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token (a Gecko id or a symbol), even when its cap is unusable. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades, not an exchange, not a versioned pool. This is the
 * watchlist's own definition of a token that does not exist yet, applied to the whole board.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/**
 * The 53 DefiLlama categories grouped into 16 families, from the category names alone:
 * protocols that do the same kind of thing share a family, so a family's token record is
 * one number the odds model can learn from instead of 53 thin categories. The grouping was
 * fixed before any outcome was fitted, and the family term still has to survive both held-out
 * tests to be kept.
 */
export const FAMILY: Record<string, string> = {
  'Dexs': 'dex',
  'Lending': 'lending', 'CDP': 'lending', 'CDP Manager': 'lending', 'Uncollateralized Lending': 'lending',
  'Collateral Management': 'lending', 'Collateral Markets': 'lending',
  'Liquid Staking': 'staking', 'Liquid Restaking': 'staking', 'Restaking': 'staking', 'Restaked BTC': 'staking', 'Staking Pool': 'staking',
  'Bridge': 'bridge', 'Canonical Bridge': 'bridge', 'Cross Chain Bridge': 'bridge',
  'Yield': 'yield', 'Yield Aggregator': 'yield', 'Leveraged Farming': 'yield', 'Farm': 'yield', 'Liquidity Manager': 'yield',
  'Derivatives': 'derivatives', 'Options': 'derivatives', 'Options Vault': 'derivatives',
  'Interest Rate Derivatives': 'derivatives', 'Basis Trading': 'derivatives', 'Synthetics': 'derivatives',
  'RWA': 'rwa', 'CeDeFi': 'rwa', 'Payments': 'rwa', 'Crypto Card Issuer': 'rwa', 'Stablecoin Issuer': 'rwa',
  'Stablecoin Wrapper': 'rwa', 'Algo-Stables': 'rwa', 'Dual-Token Stablecoin': 'rwa', 'Reserve Currency': 'rwa',
  'Risk Curators': 'curator', 'Onchain Capital Allocator': 'curator', 'Indexes': 'curator',
  'CEX': 'exchange', 'Chain': 'chain',
  'Privacy': 'btc', 'Decentralized BTC': 'btc', 'Anchor BTC': 'btc',
  'Launchpad': 'launch', 'Token Locker': 'launch', 'Governance Incentives': 'launch',
  'Prediction Market': 'predict', 'Insurance': 'insurance',
  'AI Agents': 'ai', 'Decentralized AI': 'ai',
  'NFT Marketplace': 'other', 'OTC Marketplace': 'other', 'DOR': 'other',
};

/** A protocol's family, from its category; uncategorised protocols share one family. */
export function familyOf(p: SnapshotProtocol): string {
  return FAMILY[p.category ?? ''] ?? 'other';
}

/** How far a family offset is pulled toward zero in the value model: n/(n+16). */
export const FAMILY_SHRINK = 16;

/**
 * Whether a protocol belongs in the token-odds peer set: it records a listing date, and it is
 * not a bridge, a liquid-staking or restaking product, or an exchange — the same cleanliness the
 * board applies when it ranks — and its name carries no whole word wrapped, staked or staking.
 * Versioned pools stay: a version of a protocol whose token trades is a peer that recorded one.
 * 446 of the 645 dated protocols qualify, 244 of them recording a token.
 */
export function isOddsPeer(p: SnapshotProtocol): boolean {
  return p.listed_at !== null && p.tvl_usd > 0 && !EXCLUDED_CATEGORIES.has(p.category ?? '') && !WRAPPED_WORD.test(p.name);
}

// ---------------------------------------------------------------- the value model

/** A protocol's 7-day TVL change, clamped to -60%..+120%; unknown is 0. */
function growthPct(p: SnapshotProtocol): number {
  return clamp(finite(p.change_7d, 0), -60, 120);
}

/** A protocol's age in years; unknown is priced as one year. */
function ageYears(p: SnapshotProtocol, asOf: string): number {
  return (ageDays(asOf, p.listed_at) ?? 365) / 365;
}

/** log10 of one plus the chain count. */
function chainLog(p: SnapshotProtocol): number {
  return log10(1 + p.chains.length);
}

/**
 * The value model fitted on `train` (traded protocols with a listing date). `terms` is a
 * subset of size, family, category, growth, age, chains, control; `shrink` pulls each category
 * offset toward zero by n/(n+shrink), and each family offset by n/(n+16). Returns a predictor
 * of log10(mcap); the second argument is the placebo control's growth, which is 0 at
 * prediction time.
 */
export function fitValue(
  train: SnapshotProtocol[],
  terms: Set<string>,
  asOf: string,
  shrink = 0,
): (p: SnapshotProtocol, ctrl?: number) => number {
  let base: (p: SnapshotProtocol) => number;
  if (terms.has('size')) {
    const X = train.map((p) => [1, log10(p.tvl_usd)]);
    const y = train.map((p) => log10(p.mcap_usd!));
    const beta = ols(X, y) ?? [0, 0];
    base = (p) => beta[0]! + beta[1]! * log10(Math.max(p.tvl_usd, 1));
  } else {
    const med = median(
      train.map((p) => p.mcap_usd! / p.tvl_usd),
      0.25,
    );
    base = (p) => log10(p.tvl_usd * med);
  }
  const catOff = new Map<string, number>();
  if (terms.has('category')) {
    const res = new Map<string, number[]>();
    for (const p of train) {
      const key = p.category ?? '(uncategorised)';
      const list = res.get(key);
      const r = log10(p.mcap_usd!) - base(p);
      if (list === undefined) res.set(key, [r]);
      else list.push(r);
    }
    for (const [c, r] of res) {
      if (r.length >= 5) catOff.set(c, median(r, 0) * (shrink > 0 ? r.length / (r.length + shrink) : 1));
    }
  }
  const famOff = new Map<string, number>();
  if (terms.has('family')) {
    const res = new Map<string, number[]>();
    for (const p of train) {
      const key = familyOf(p);
      const list = res.get(key);
      const r = log10(p.mcap_usd!) - base(p);
      if (list === undefined) res.set(key, [r]);
      else list.push(r);
    }
    for (const [c, r] of res) {
      famOff.set(c, median(r, 0) * (r.length / (r.length + FAMILY_SHRINK)));
    }
  }
  const pred1 = (p: SnapshotProtocol): number =>
    base(p) + (famOff.get(familyOf(p)) ?? 0) + (catOff.get(p.category ?? '(uncategorised)') ?? 0);
  const extra = ['growth', 'age', 'chains', 'control'].filter((t) => terms.has(t));
  if (extra.length === 0) return (p) => pred1(p);
  const feats = (p: SnapshotProtocol, ctrl: number): number[] => {
    const f: number[] = [];
    if (extra.includes('growth')) f.push(growthPct(p));
    if (extra.includes('age')) f.push(ageYears(p, asOf));
    if (extra.includes('chains')) f.push(chainLog(p));
    if (extra.includes('control')) f.push(ctrl);
    return f;
  };
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < train.length; i++) {
    const p = train[i]!;
    let ctrl = 0;
    if (extra.includes('control')) ctrl = growthPct(train[(i + 1) % train.length]!);
    X.push([1, ...feats(p, ctrl)]);
    y.push(log10(p.mcap_usd!) - pred1(p));
  }
  const coef = ols(X, y) ?? new Array<number>(1 + extra.length).fill(0);
  return (p, ctrl = 0) => {
    const f = feats(p, ctrl);
    let v = pred1(p) + coef[0]!;
    for (let j = 0; j < f.length; j++) v += coef[j + 1]! * f[j]!;
    return v;
  };
}

/** Leave-one-out median miss of a term set over the dated traded protocols. */
function looMiss(data: SnapshotProtocol[], terms: Set<string>, asOf: string, shrink = 0): number {
  const ms: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const train = [...data.slice(0, i), ...data.slice(i + 1)];
    const fit = fitValue(train, terms, asOf, shrink);
    const p = data[i]!;
    const pr = 10 ** fit(p);
    ms.push(Math.max(pr / p.mcap_usd!, p.mcap_usd! / pr));
  }
  return median(ms, 0);
}

/** Walk-forward median miss: fit only on tokens listed earlier, predict each later one. */
function walkforwardMiss(data: SnapshotProtocol[], terms: Set<string>, asOf: string, minTrain = 20, shrink = 0): number {
  const d = [...data].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const ms: number[] = [];
  for (let i = minTrain; i < d.length; i++) {
    const fit = fitValue(d.slice(0, i), terms, asOf, shrink);
    const p = d[i]!;
    const pr = 10 ** fit(p);
    ms.push(Math.max(pr / p.mcap_usd!, p.mcap_usd! / pr));
  }
  return median(ms, 0);
}

/** Leave-one-out mean |log10 miss| of a term set: the discriminating metric the median cannot see. */
function looMeanLog(data: SnapshotProtocol[], terms: Set<string>, asOf: string, shrink = 0): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    const train = [...data.slice(0, i), ...data.slice(i + 1)];
    const fit = fitValue(train, terms, asOf, shrink);
    const p = data[i]!;
    s += Math.abs(fit(p) - Math.log10(p.mcap_usd!));
  }
  return s / data.length;
}

/**
 * Walk-forward mean |log10 miss|: fit only on tokens listed earlier, predict each later one.
 * minTrain 55 is the second walk-forward design (train-first-55): a term is kept only when it
 * wins both-ways under both designs, or on mean-log without worsening either median.
 */
function walkforwardMeanLog(data: SnapshotProtocol[], terms: Set<string>, asOf: string, minTrain = 20, shrink = 0): number {
  const d = [...data].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  let s = 0;
  let n = 0;
  for (let i = minTrain; i < d.length; i++) {
    const fit = fitValue(d.slice(0, i), terms, asOf, shrink);
    const p = d[i]!;
    s += Math.abs(fit(p) - Math.log10(p.mcap_usd!));
    n++;
  }
  return s / n;
}

/** The leave-one-out residual ratios actual/predicted of a term set, in protocol order. */
function looRatios(data: SnapshotProtocol[], terms: Set<string>, asOf: string, shrink = 0): number[] {
  const rs: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const train = [...data.slice(0, i), ...data.slice(i + 1)];
    const fit = fitValue(train, terms, asOf, shrink);
    const p = data[i]!;
    rs.push(p.mcap_usd! / 10 ** fit(p));
  }
  return rs;
}

/** The walk-forward residual ratios actual/predicted of a term set. */
function walkforwardRatios(data: SnapshotProtocol[], terms: Set<string>, asOf: string, minTrain = 20, shrink = 0): number[] {
  const d = [...data].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const rs: number[] = [];
  for (let i = minTrain; i < d.length; i++) {
    const fit = fitValue(d.slice(0, i), terms, asOf, shrink);
    const p = d[i]!;
    rs.push(p.mcap_usd! / 10 ** fit(p));
  }
  return rs;
}

/** The value term ladder, as (label, terms) pairs: the single source of truth for the fit and for the nested check's re-pick. */
const VALUE_TERM_SETS: { label: string; terms: string[] }[] = [
  { label: 'flat median', terms: [] },
  { label: '+ size curve', terms: ['size'] },
  { label: '+ family effect', terms: ['size', 'family'] },
  { label: '+ category effect', terms: ['size', 'family', 'category'] },
  { label: '+ 7d growth', terms: ['size', 'family', 'category', 'growth'] },
  { label: '+ age', terms: ['size', 'family', 'category', 'growth', 'age'] },
  { label: '+ chain count', terms: ['size', 'family', 'category', 'growth', 'age', 'chains'] },
  { label: '+ control (placebo)', terms: ['size', 'family', 'category', 'growth', 'age', 'chains', 'control'] },
];

/**
 * The both-ways term selection, run on one train set: the ladder's LOO + walk-forward median
 * miss, then the shrunk-category variants against the size-only set. Returns the kept set and
 * its shrink (0 when the shrink branch did not fire). This is the same rule fitValueModel
 * applies to the full data.
 */
function selectValueKept(data: SnapshotProtocol[], asOf: string): { kept: Set<string>; shrink: number } {
  let keptLoo = 0;
  let keptWf = 0;
  let kept = new Set<string>();
  for (const [idx, s] of VALUE_TERM_SETS.entries()) {
    const set = new Set(s.terms);
    const loo = looMiss(data, set, asOf);
    const wf = walkforwardMiss(data, set, asOf);
    if (idx === 0) {
      keptLoo = loo;
      keptWf = wf;
    } else if (loo < keptLoo && wf < keptWf) {
      kept = set;
      keptLoo = loo;
      keptWf = wf;
    }
  }
  const sizeOnly = new Set(['size']);
  const sizeLoo = looMiss(data, sizeOnly, asOf);
  const sizeWf = walkforwardMiss(data, sizeOnly, asOf);
  let shrink = 0;
  for (const sh of [5, 10, 20]) {
    const catSet = new Set(['size', 'category']);
    const loo = looMiss(data, catSet, asOf, sh);
    const wf = walkforwardMiss(data, catSet, asOf, 20, sh);
    if (loo < sizeLoo && wf < sizeWf && shrink === 0) {
      kept = new Set(['size', 'category']);
      shrink = sh;
    }
  }
  return { kept, shrink };
}

/** Listing-date order (undated last), the same order walkforwardMiss walks. */
function byListedAt(a: SnapshotProtocol, b: SnapshotProtocol): number {
  const ka = a.listed_at ?? '9999';
  const kb = b.listed_at ?? '9999';
  return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/** A seeded shuffle (Fisher-Yates, mulberry32) of a copy of the list. */
function seededShuffle<T>(list: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** The nested check's seed: one seed for both the value and the odds check. */
const NESTED_SEED = 20261125;

/**
 * The nested term-selection check for the value model: re-pick the kept set inside each split
 * and score the fixed (full-data) set against the re-picked set on the same held-out rows,
 * both fitted on the split's train part only. 5-fold: seeded shuffle of the listing-date
 * order, fold = position mod 5. Walk-forward: one split, train on the earliest 60% listed,
 * test on the latest 40%. Scores are median miss.
 */
export function nestedValueCheck(tradedDated: SnapshotProtocol[], asOf: string): NestedCheck {
  const fixed = selectValueKept(tradedDated, asOf);
  const fixedMiss: number[] = [];
  const repickedMiss: number[] = [];
  const picks: string[] = [];
  const shuffled = seededShuffle([...tradedDated].sort(byListedAt), NESTED_SEED);
  for (let f = 0; f < 5; f++) {
    const test = shuffled.filter((_, i) => i % 5 === f);
    const train = shuffled.filter((_, i) => i % 5 !== f);
    const repicked = selectValueKept(train, asOf);
    picks.push([...repicked.kept].sort().join('+') || 'flat');
    const fixedFit = fitValue(train, fixed.kept, asOf, fixed.shrink);
    const repickedFit = fitValue(train, repicked.kept, asOf, repicked.shrink);
    for (const p of test) {
      const prF = 10 ** fixedFit(p);
      fixedMiss.push(Math.max(prF / p.mcap_usd!, p.mcap_usd! / prF));
      const prR = 10 ** repickedFit(p);
      repickedMiss.push(Math.max(prR / p.mcap_usd!, p.mcap_usd! / prR));
    }
  }
  const ordered = [...tradedDated].sort(byListedAt);
  const cut = Math.floor(ordered.length * 0.6);
  const wfTrain = ordered.slice(0, cut);
  const wfTest = ordered.slice(cut);
  const wfRepicked = selectValueKept(wfTrain, asOf);
  const wfFixedFit = fitValue(wfTrain, fixed.kept, asOf, fixed.shrink);
  const wfRepickedFit = fitValue(wfTrain, wfRepicked.kept, asOf, wfRepicked.shrink);
  const wfFixedMiss: number[] = [];
  const wfRepickedMiss: number[] = [];
  for (const p of wfTest) {
    const prF = 10 ** wfFixedFit(p);
    wfFixedMiss.push(Math.max(prF / p.mcap_usd!, p.mcap_usd! / prF));
    const prR = 10 ** wfRepickedFit(p);
    wfRepickedMiss.push(Math.max(prR / p.mcap_usd!, p.mcap_usd! / prR));
  }
  return {
    five_fold_fixed: round4(median(fixedMiss, 0)),
    five_fold_repicked: round4(median(repickedMiss, 0)),
    five_fold_picks: picks,
    wf_fixed: round4(median(wfFixedMiss, 0)),
    wf_repicked: round4(median(wfRepickedMiss, 0)),
    wf_pick: [...wfRepicked.kept].sort().join('+') || 'flat',
  };
}

/**
 * The value model, fitted and validated on the dated traded protocols: the term ladder (each
 * cumulative set, kept only when it lowers both the leave-one-out and the walk-forward miss
 * against the last kept set — a term that only beats a dropped row is not kept), the
 * shrunk-category variants, the residual ranges and their honesty, and the bootstrap standard
 * errors of the size curve.
 */
export function fitValueModel(tradedDated: SnapshotProtocol[], asOf: string): ValueModel {
  const termSets = VALUE_TERM_SETS;
  const terms: ValueTermResult[] = [];
  let keptLoo = 0;
  let keptWf = 0;
  let kept = new Set<string>();
  for (const [idx, s] of termSets.entries()) {
    const set = new Set(s.terms);
    const loo = looMiss(tradedDated, set, asOf);
    const wf = walkforwardMiss(tradedDated, set, asOf);
    const looMean = looMeanLog(tradedDated, set, asOf);
    const wfMean = walkforwardMeanLog(tradedDated, set, asOf);
    const wf55 = walkforwardMiss(tradedDated, set, asOf, 55);
    const wf55Mean = walkforwardMeanLog(tradedDated, set, asOf, 55);
    let isKept = false;
    if (idx === 0) {
      keptLoo = loo;
      keptWf = wf;
    } else if (loo < keptLoo && wf < keptWf) {
      kept = set;
      isKept = true;
      keptLoo = loo;
      keptWf = wf;
    }
    terms.push({ label: s.label, terms: s.terms, loo: round4(loo), wf: round4(wf), loo_meanlog: round4(looMean), wf_meanlog: round4(wfMean), wf55: round4(wf55), wf55_meanlog: round4(wf55Mean), kept: isKept });
  }
  // The raw category offsets were too noisy for walk-forward; try shrinking them toward zero.
  const sizeOnly = terms[1]!;
  const shrunkCategory: { shrink: number; loo: number; wf: number; kept: boolean }[] = [];
  let keptShrink = 0;
  for (const shrink of [5, 10, 20]) {
    const catSet = new Set(['size', 'category']);
    const loo = looMiss(tradedDated, catSet, asOf, shrink);
    const wf = walkforwardMiss(tradedDated, catSet, asOf, 20, shrink);
    const looMean = looMeanLog(tradedDated, catSet, asOf, shrink);
    const wfMean = walkforwardMeanLog(tradedDated, catSet, asOf, 20, shrink);
    const wf55 = walkforwardMiss(tradedDated, catSet, asOf, 55, shrink);
    const wf55Mean = walkforwardMeanLog(tradedDated, catSet, asOf, 55, shrink);
    const isKept = loo < sizeOnly.loo && wf < sizeOnly.wf;
    if (isKept && keptShrink === 0) {
      kept = new Set(['size', 'category']);
      keptShrink = shrink;
    }
    shrunkCategory.push({ shrink, loo: round4(loo), wf: round4(wf), loo_meanlog: round4(looMean), wf_meanlog: round4(wfMean), wf55: round4(wf55), wf55_meanlog: round4(wf55Mean), kept: isKept });
  }
  const keptTerms = [...kept].sort();
  const keptSet = kept.size > 0 ? kept : new Set<string>();
  // The size curve's own coefficients, on all dated traded protocols.
  const X = tradedDated.map((p) => [1, log10(p.tvl_usd)]);
  const y = tradedDated.map((p) => log10(p.mcap_usd!));
  const beta = ols(X, y) ?? [0, 0];
  const meanY = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((a, v) => a + (v - meanY) * (v - meanY), 0);
  const ssRes = y.reduce((a, v, i) => {
    const pr = beta[0]! + beta[1]! * log10(tradedDated[i]!.tvl_usd);
    return a + (v - pr) * (v - pr);
  }, 0);
  const fit: SizeCurveFit = { intercept: round4(beta[0]!), slope: round4(beta[1]!), r2: round4(1 - ssRes / ssTot), n: tradedDated.length };
  const flatMedian = round4(median(tradedDated.map((p) => p.mcap_usd! / p.tvl_usd), 0.25));
  const multipleAt = (tvl: number): number => 10 ** (beta[0]! + beta[1]! * log10(tvl)) / tvl;
  // Ranges from the kept model's leave-one-out residuals, and how often they hold.
  const looR = looRatios(tradedDated, keptSet, asOf, keptShrink);
  const sortedLoo = [...looR].sort((a, b) => a - b);
  const wfR = walkforwardRatios(tradedDated, keptSet, asOf, 20, keptShrink);
  const p25 = percentile(sortedLoo, 0.25);
  const p75 = percentile(sortedLoo, 0.75);
  const p10 = percentile(sortedLoo, 0.1);
  const p90 = percentile(sortedLoo, 0.9);
  const ranges: RangeStats = {
    p10: round4(p10),
    p25: round4(p25),
    p50: round4(percentile(sortedLoo, 0.5)),
    p75: round4(p75),
    p90: round4(p90),
    loo_in_p25_p75: round4(looR.filter((r) => r >= p25 && r <= p75).length / looR.length),
    loo_in_p10_p90: round4(looR.filter((r) => r >= p10 && r <= p90).length / looR.length),
    wf_in_p25_p75: round4(wfR.filter((r) => r >= p25 && r <= p75).length / wfR.length),
    wf_in_p10_p90: round4(wfR.filter((r) => r >= p10 && r <= p90).length / wfR.length),
    wf_n: wfR.length,
    within_x3_loo: round4(looR.filter((r) => r >= 1 / 3 && r <= 3).length / looR.length),
    within_x3_wf: round4(wfR.filter((r) => r >= 1 / 3 && r <= 3).length / wfR.length),
  };
  // Category median offsets (shrink 64, n>=5) on the size-only residuals, for the board's
  // fitted-values note: only 8 categories qualify; the range shows the slope gap to #1 is noise.
  const catRes = new Map<string, number[]>();
  for (const p of tradedDated) {
    const key = p.category ?? '(uncategorised)';
    const list = catRes.get(key) ?? [];
    list.push(log10(p.mcap_usd!) - (beta[0]! + beta[1]! * log10(p.tvl_usd)));
    catRes.set(key, list);
  }
  const categoryOffsets64 = [...catRes.entries()]
    .filter(([, r]) => r.length >= 5)
    .map(([category, r]) => ({ category, n: r.length, offset: round4(median(r, 0) * (r.length / (r.length + 64))) }))
    .sort((a, b) => a.offset - b.offset);
  // Bootstrap standard errors: 200 refits on resamples of the dated traded protocols.
  const rng = mulberry32(20261114);
  const betas: number[][] = [];
  for (let k = 0; k < 200; k++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < tradedDated.length; i++) sample.push(tradedDated[Math.floor(rng() * tradedDated.length)]!);
    const b = ols(
      sample.map((p) => [1, log10(p.tvl_usd)]),
      sample.map((p) => log10(p.mcap_usd!)),
    );
    if (b !== null) betas.push(b);
  }
  const bootstrap: BootstrapStats = {
    refits: betas.length,
    intercept_se: round4(sampleSd(betas.map((b) => b[0]!))),
    slope_se: round4(sampleSd(betas.map((b) => b[1]!))),
    multiple_100m: round4(multipleAt(1e8)),
    multiple_100m_se: round4(sampleSd(betas.map((b) => 10 ** (b[0]! + b[1]! * 8) / 1e8))),
  };
  return {
    fit,
    flat_median: flatMedian,
    multiple_100m: round4(multipleAt(1e8)),
    multiple_1b: round4(multipleAt(1e9)),
    multiple_10b: round4(multipleAt(1e10)),
    terms,
    kept_terms: keptTerms,
    kept_shrink: keptShrink,
    shrunk_category: shrunkCategory,
    category_offsets_64: categoryOffsets64,
    ranges,
    bootstrap,
  };
}

// ---------------------------------------------------------------- the token-odds model

/**
 * The five odds features, in order: age (years), size (log10 TVL), growth (%), chains (log10),
 * and the protocol's family token rate — the share of its family's peers that recorded a token,
 * shrunk 256 pseudo-counts toward the train set's base rate, so a thin family does not shout.
 * The rate is fitted on the train set only, never on the protocol being scored. The 256-shrink
 * rate is the E10 ridge-λ=256 family: the ridge offset (k − n·base)/(n+256) equals this rate up
 * to the constant base rate, which the logistic standardisation removes, so the fitted model is
 * exactly the ridge-λ=256 variant (Brier 0.1893/0.2080, total $954.9M).
 */
function oddsFeatures(p: SnapshotProtocol, asOf: string, famRate: Map<string, number>, baseRate: number): number[] {
  return [ageYears(p, asOf), log10(Math.max(p.tvl_usd, 1)), growthPct(p), chainLog(p), famRate.get(familyOf(p)) ?? baseRate];
}

/** A family's token rate on a train set, shrunk toward the train base rate (λ=256: the E10 ridge family). */
function famRates(train: SnapshotProtocol[], lambda = 256): { rates: Map<string, number>; base: number } {
  const base = train.filter((q) => recordsToken(q)).length / train.length;
  const agg = new Map<string, { n: number; y: number }>();
  for (const p of train) {
    const f = familyOf(p);
    const a = agg.get(f) ?? { n: 0, y: 0 };
    a.n++;
    a.y += recordsToken(p) ? 1 : 0;
    agg.set(f, a);
  }
  const rates = new Map<string, number>();
  for (const [f, a] of agg) rates.set(f, (a.y + lambda * base) / (a.n + lambda));
  return { rates, base };
}

/** A logistic regression: standardized features, gradient descent, 500 steps at rate 0.5. */
export interface LogitModel {
  weights: number[];
  means: number[];
  sds: number[];
  famRate: Map<string, number>;
  baseRate: number;
}

function fitLogit(train: SnapshotProtocol[], use: number[], asOf: string, iters = 500, lr = 0.5): LogitModel {
  const { rates, base } = famRates(train);
  const F = train.map((p) => oddsFeatures(p, asOf, rates, base));
  const means = [0, 1, 2, 3, 4].map((j) => F.reduce((a, f) => a + f[j]!, 0) / F.length);
  const sds = [0, 1, 2, 3, 4].map((j) => {
    const m = means[j]!;
    const v = Math.sqrt(F.reduce((a, f) => a + (f[j]! - m) * (f[j]! - m), 0) / F.length);
    return v === 0 ? 1 : v;
  });
  const y = train.map((p) => (recordsToken(p) ? 1 : 0));
  const k = 1 + use.length;
  const w = new Array<number>(k).fill(0);
  const X = train.map((p) => {
    const z = oddsFeatures(p, asOf, rates, base).map((v, j) => (v - means[j]!) / sds[j]!);
    return [1, ...use.map((u) => z[u]!)];
  });
  for (let it = 0; it < iters; it++) {
    const g = new Array<number>(k).fill(0);
    for (let r = 0; r < X.length; r++) {
      let z = 0;
      for (let j = 0; j < k; j++) z += w[j]! * X[r]![j]!;
      const pr = 1 / (1 + Math.exp(-clamp(z, -30, 30)));
      const e = pr - y[r]!;
      for (let j = 0; j < k; j++) g[j] = g[j]! + e * X[r]![j]!;
    }
    for (let j = 0; j < k; j++) w[j] = w[j]! - (lr * g[j]!) / X.length;
  }
  return { weights: w, means, sds, famRate: rates, baseRate: base };
}

function predictLogit(model: LogitModel, p: SnapshotProtocol, use: number[], asOf: string): number {
  const f = oddsFeatures(p, asOf, model.famRate, model.baseRate);
  const z = f.map((v, j) => (v - model.means[j]!) / model.sds[j]!);
  const x = [1, ...use.map((u) => z[u]!)];
  let v = 0;
  for (let j = 0; j < x.length; j++) v += model.weights[j]! * x[j]!;
  return 1 / (1 + Math.exp(-clamp(v, -30, 30)));
}

/** Leave-one-out Brier score of a feature set over the dated protocols. */
function looBrier(data: SnapshotProtocol[], use: number[], asOf: string, baseRate: number, iters = 200): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    const train = [...data.slice(0, i), ...data.slice(i + 1)];
    const pr = use.length === 0 ? baseRate : predictLogit(fitLogit(train, use, asOf, iters), data[i]!, use, asOf);
    const y = recordsToken(data[i]!) ? 1 : 0;
    s += (pr - y) * (pr - y);
  }
  return s / data.length;
}

/** Walk-forward Brier score: fit only on protocols listed earlier, predict each later one. */
function walkforwardBrier(data: SnapshotProtocol[], use: number[], asOf: string, minTrain = 60, iters = 200): number {
  const d = [...data].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  let s = 0;
  let n = 0;
  for (let i = minTrain; i < d.length; i++) {
    const train = d.slice(0, i);
    const base = train.filter((q) => recordsToken(q)).length / train.length;
    const pr = use.length === 0 ? base : predictLogit(fitLogit(train, use, asOf, iters), d[i]!, use, asOf);
    const y = recordsToken(d[i]!) ? 1 : 0;
    s += (pr - y) * (pr - y);
    n++;
  }
  return s / n;
}

/** Leave-one-out called-right share of a feature set: prediction ≥0.5 counts as "records a token". */
function looCalledRight(data: SnapshotProtocol[], use: number[], asOf: string, baseRate: number, iters = 200): number {
  let right = 0;
  for (let i = 0; i < data.length; i++) {
    const train = [...data.slice(0, i), ...data.slice(i + 1)];
    const pr = use.length === 0 ? baseRate : predictLogit(fitLogit(train, use, asOf, iters), data[i]!, use, asOf);
    if ((pr >= 0.5) === recordsToken(data[i]!)) right++;
  }
  return right / data.length;
}

/** Walk-forward called-right share: fit only on protocols listed earlier, predict each later one. */
function walkforwardCalledRight(data: SnapshotProtocol[], use: number[], asOf: string, minTrain = 60, iters = 200): number {
  const d = [...data].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  let right = 0;
  let n = 0;
  for (let i = minTrain; i < d.length; i++) {
    const train = d.slice(0, i);
    const base = train.filter((q) => recordsToken(q)).length / train.length;
    const pr = use.length === 0 ? base : predictLogit(fitLogit(train, use, asOf, iters), d[i]!, use, asOf);
    if ((pr >= 0.5) === recordsToken(d[i]!)) right++;
    n++;
  }
  return right / n;
}

/** The odds feature ladder, as (label, features) pairs: the single source of truth for the fit and for the nested check's re-pick. Features, in order: age, family token rate, size, growth, chains. */
const ODDS_FEATURE_SETS: { label: string; features: number[] }[] = [
  { label: 'base rate', features: [] },
  { label: '+ age', features: [0] },
  { label: '+ family', features: [0, 4] },
  { label: '+ size', features: [0, 4, 1] },
  { label: '+ growth', features: [0, 4, 1, 2] },
  { label: '+ chains', features: [0, 4, 1, 2, 3] },
];

/**
 * The both-ways feature selection, run on one train set: the ladder's LOO + walk-forward
 * Brier, kept only when a set lowers both against the last kept set. This is the same rule
 * fitOddsModel applies to the full data.
 */
function selectOddsUse(data: SnapshotProtocol[], asOf: string): number[] {
  const baseRate = data.filter((p) => recordsToken(p)).length / data.length;
  let keptLoo = 0;
  let keptWf = 0;
  let use: number[] = [];
  for (const [idx, s] of ODDS_FEATURE_SETS.entries()) {
    const loo = looBrier(data, s.features, asOf, baseRate);
    const wf = walkforwardBrier(data, s.features, asOf);
    if (idx === 0) {
      keptLoo = loo;
      keptWf = wf;
    } else if (loo < keptLoo && wf < keptWf) {
      use = s.features;
      keptLoo = loo;
      keptWf = wf;
    }
  }
  return use;
}

/**
 * The nested term-selection check for the odds model: re-pick the feature set inside each
 * split and score the fixed (full-data) set against the re-picked set on the same held-out
 * peers, both fitted on the split's train part only. Same designs as the value check (seeded
 * 5-fold, one walk-forward split at 60%); scores are mean Brier, and every fit uses the
 * 200-iteration fits the ladder itself uses.
 */
export function nestedOddsCheck(peers: SnapshotProtocol[], asOf: string): NestedCheck {
  const fixedUse = selectOddsUse(peers, asOf);
  const names = ['age', 'family', 'size', 'growth', 'chains'];
  const useLabel = (use: number[]): string => (use.length === 0 ? 'base rate' : use.map((u) => names[u]!).join('+'));
  const fixedSq: number[] = [];
  const repickedSq: number[] = [];
  const picks: string[] = [];
  const shuffled = seededShuffle([...peers].sort(byListedAt), NESTED_SEED);
  for (let f = 0; f < 5; f++) {
    const test = shuffled.filter((_, i) => i % 5 === f);
    const train = shuffled.filter((_, i) => i % 5 !== f);
    const repickedUse = selectOddsUse(train, asOf);
    picks.push(useLabel(repickedUse));
    const trainBase = train.filter((p) => recordsToken(p)).length / train.length;
    const fixedModel = fitLogit(train, fixedUse, asOf, 200);
    const repickedModel = fitLogit(train, repickedUse, asOf, 200);
    for (const p of test) {
      const y = recordsToken(p) ? 1 : 0;
      const prF = fixedUse.length === 0 ? trainBase : predictLogit(fixedModel, p, fixedUse, asOf);
      fixedSq.push((prF - y) * (prF - y));
      const prR = repickedUse.length === 0 ? trainBase : predictLogit(repickedModel, p, repickedUse, asOf);
      repickedSq.push((prR - y) * (prR - y));
    }
  }
  const ordered = [...peers].sort(byListedAt);
  const cut = Math.floor(ordered.length * 0.6);
  const wfTrain = ordered.slice(0, cut);
  const wfTest = ordered.slice(cut);
  const wfRepickedUse = selectOddsUse(wfTrain, asOf);
  const wfTrainBase = wfTrain.filter((p) => recordsToken(p)).length / wfTrain.length;
  const wfFixedModel = fitLogit(wfTrain, fixedUse, asOf, 200);
  const wfRepickedModel = fitLogit(wfTrain, wfRepickedUse, asOf, 200);
  const wfFixedSq: number[] = [];
  const wfRepickedSq: number[] = [];
  for (const p of wfTest) {
    const y = recordsToken(p) ? 1 : 0;
    const prF = fixedUse.length === 0 ? wfTrainBase : predictLogit(wfFixedModel, p, fixedUse, asOf);
    wfFixedSq.push((prF - y) * (prF - y));
    const prR = wfRepickedUse.length === 0 ? wfTrainBase : predictLogit(wfRepickedModel, p, wfRepickedUse, asOf);
    wfRepickedSq.push((prR - y) * (prR - y));
  }
  const mean = (vs: number[]): number => vs.reduce((a, b) => a + b, 0) / vs.length;
  return {
    five_fold_fixed: round4(mean(fixedSq)),
    five_fold_repicked: round4(mean(repickedSq)),
    five_fold_picks: picks,
    wf_fixed: round4(mean(wfFixedSq)),
    wf_repicked: round4(mean(wfRepickedSq)),
    wf_pick: useLabel(wfRepickedUse),
  };
}

/**
 * The token-odds model, fitted and validated on the odds peers (dated protocols that are not a
 * bridge, a liquid-staking or restaking product, or an exchange, and whose name carries no
 * wrapped/staked word — see isOddsPeer): the feature ladder (each cumulative set, kept only
 * when it lowers both the leave-one-out and the walk-forward Brier against the last kept set),
 * and the placebo that must not help. Features, in order: age, family token rate, size, growth,
 * chains.
 */
export function fitOddsModel(peers: SnapshotProtocol[], asOf: string): OddsModel {
  const recorded = peers.filter((p) => recordsToken(p)).length;
  const baseRate = recorded / peers.length;
  const sets = ODDS_FEATURE_SETS;
  const terms: OddsTermResult[] = [];
  let keptLoo = 0;
  let keptWf = 0;
  let use: number[] = [];
  for (const [idx, s] of sets.entries()) {
    const loo = looBrier(peers, s.features, asOf, baseRate);
    const wf = walkforwardBrier(peers, s.features, asOf);
    let isKept = false;
    if (idx === 0) {
      keptLoo = loo;
      keptWf = wf;
    } else if (loo < keptLoo && wf < keptWf) {
      use = s.features;
      isKept = true;
      keptLoo = loo;
      keptWf = wf;
    }
    terms.push({ label: s.label, features: s.features, loo: round4(loo), wf: round4(wf), kept: isKept });
  }
  // The placebo: each peer's growth replaced by the next peer's growth (listing-date order).
  // If growth carried real signal, the shuffled version must not help.
  const ordered = [...peers].sort((a, b) => {
    const ka = a.listed_at ?? '9999';
    const kb = b.listed_at ?? '9999';
    return ka < kb ? -1 : ka > kb ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
  });
  const placeboPeers = ordered.map((p, i) => ({ ...p, change_7d: ordered[(i + 1) % ordered.length]!.change_7d }));
  const placeboLoo = looBrier(placeboPeers, [0, 4, 1, 2, 3], asOf, baseRate);
  const placeboWf = walkforwardBrier(placeboPeers, [0, 4, 1, 2, 3], asOf);
  const finalModel = fitLogit(peers, use, asOf, 500);
  const baseBrier = baseRate * (1 - baseRate);
  const familyRates: Record<string, number> = {};
  for (const [f, r] of [...finalModel.famRate.entries()].sort()) familyRates[f] = round4(r);
  // Called-right for the kept set, and bootstrap SEs for the growth weight (E12): 200 refits
  // on resampled peers, same seed family as the value bootstrap. The growth weight is
  // standardised; per-unit divides by the growth feature's sd, per refit.
  const calledRightLoo = looCalledRight(peers, use, asOf, baseRate);
  const calledRightWf = walkforwardCalledRight(peers, use, asOf);
  const growthIdx = use.indexOf(2);
  const rng = mulberry32(20261115);
  const growthW: number[] = [];
  const growthPerUnit: number[] = [];
  for (let k = 0; k < 200; k++) {
    const sample: SnapshotProtocol[] = [];
    for (let i = 0; i < peers.length; i++) sample.push(peers[Math.floor(rng() * peers.length)]!);
    const m = fitLogit(sample, use, asOf, 500);
    if (growthIdx >= 0) {
      growthW.push(m.weights[growthIdx + 1]!);
      growthPerUnit.push(m.weights[growthIdx + 1]! / m.sds[2]!);
    }
  }
  const mean = (vs: number[]): number => vs.reduce((a, b) => a + b, 0) / vs.length;
  return {
    weights: finalModel.weights.map((w) => round4(w)),
    use,
    base_rate: round4(baseRate),
    peers: peers.length,
    recorded,
    brier_loo: round4(looBrier(peers, use, asOf, baseRate)),
    brier_wf: round4(walkforwardBrier(peers, use, asOf)),
    base_brier_loo: round4(baseBrier),
    base_brier_wf: round4(walkforwardBrier(peers, [], asOf)),
    terms,
    placebo_loo: round4(placeboLoo),
    placebo_wf: round4(placeboWf),
    family_rates: familyRates,
    called_right_loo: round4(calledRightLoo),
    called_right_wf: round4(calledRightWf),
    growth_se: round4(sampleSd(growthW)),
    growth_mean: round4(mean(growthW)),
    growth_per_unit: growthIdx >= 0 ? round4(finalModel.weights[growthIdx + 1]! / finalModel.sds[2]!) : 0,
    growth_per_unit_se: round4(sampleSd(growthPerUnit)),
  };
}

// ---------------------------------------------------------------- accounting and farm economics

/** The whole snapshot's accounting: every protocol in exactly one group. */
export function accountFor(snapshot: Snapshot, boardSlugs: Set<string>): Accounting {
  const a: Accounting = {
    ranked_watchlist: 0,
    ranked_early: 0,
    token_priced: 0,
    token_no_cap: 0,
    out_category: 0,
    out_versioned: 0,
    out_wrapped: 0,
    out_exchange: 0,
    out_other: 0,
    total: snapshot.protocols.length,
  };
  for (const p of snapshot.protocols) {
    if (boardSlugs.has(p.slug)) {
      if (snapshot.watchlist.includes(p.slug)) a.ranked_watchlist++;
      else a.ranked_early++;
    } else if (recordsToken(p)) {
      if (p.mcap_usd !== null) a.token_priced++;
      else a.token_no_cap++;
    } else if (EXCLUDED_CATEGORIES.has(p.category ?? '')) a.out_category++;
    else if (VERSIONED.test(p.name)) a.out_versioned++;
    else if (WRAPPED_WORD.test(p.name)) a.out_wrapped++;
    else if (EXCHANGE_PREFIX.test(p.name)) a.out_exchange++;
    else a.out_other++;
  }
  return a;
}

/** A farm position's economics under the plan defaults. */
export function farmEconomics(p: SnapshotProtocol, implied: number): FarmEconomics {
  const tvl = Math.max(p.tvl_usd, 1);
  const plan = Math.max(FARM_DEFAULTS.plan_floor, Math.min(FARM_DEFAULTS.plan_share * tvl, FARM_DEFAULTS.plan_cap));
  const gross = implied * (plan / tvl) * FARM_DEFAULTS.drop_share;
  const costs = FARM_DEFAULTS.gas_usd + plan * FARM_DEFAULTS.tbill_rate * (FARM_DEFAULTS.horizon_weeks / 52) + FARM_DEFAULTS.slippage * plan;
  const net = gross - costs;
  const annYield = (gross / plan) * (52 / FARM_DEFAULTS.horizon_weeks);
  let verdict: FarmEconomics['verdict'];
  if (net > 0 && annYield >= FARM_DEFAULTS.tbill_rate) verdict = 'FARM';
  else if (net <= -FARM_DEFAULTS.skip_loss_usd) verdict = 'SKIP';
  else verdict = 'THIN';
  return {
    plan: Math.round(plan * 100) / 100,
    gross: Math.round(gross * 100) / 100,
    costs: Math.round(costs * 100) / 100,
    net: Math.round(net * 100) / 100,
    net_per_hour: Math.round((net / FARM_DEFAULTS.hours) * 100) / 100,
    ann_yield: round4(annYield),
    verdict,
  };
}

/** The same farm economics, recomputed under the dashboard's slider values. */
export function farmEconomicsWith(
  tvlUsd: number,
  implied: number,
  planShare: number,
  dropShare: number,
  horizonWeeks: number,
): FarmEconomics {
  const plan = Math.max(FARM_DEFAULTS.plan_floor, Math.min(planShare * tvlUsd, FARM_DEFAULTS.plan_cap));
  const gross = implied * (plan / tvlUsd) * dropShare;
  const costs = FARM_DEFAULTS.gas_usd + plan * FARM_DEFAULTS.tbill_rate * (horizonWeeks / 52) + FARM_DEFAULTS.slippage * plan;
  const net = gross - costs;
  const annYield = (gross / plan) * (52 / horizonWeeks);
  let verdict: FarmEconomics['verdict'];
  if (net > 0 && annYield >= FARM_DEFAULTS.tbill_rate) verdict = 'FARM';
  else if (net <= -FARM_DEFAULTS.skip_loss_usd) verdict = 'SKIP';
  else verdict = 'THIN';
  return {
    plan: Math.round(plan * 100) / 100,
    gross: Math.round(gross * 100) / 100,
    costs: Math.round(costs * 100) / 100,
    net: Math.round(net * 100) / 100,
    net_per_hour: Math.round((net / FARM_DEFAULTS.hours) * 100) / 100,
    ann_yield: round4(annYield),
    verdict,
  };
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): {
  board: BoardRow[];
  value: ValueModel;
  odds: OddsModel;
  accounting: Accounting;
} {
  const traded = snapshot.protocols.filter((p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const tradedDated = traded.filter((p) => p.listed_at !== null);
  const peers = snapshot.protocols.filter(isOddsPeer);
  const value = fitValueModel(tradedDated, snapshot.as_of);
  const odds = fitOddsModel(peers, snapshot.as_of);
  // The nested term-selection check: re-pick the kept set inside each split and score the
  // fixed set against it. Computed once per board (the odds half is the expensive part, ~100 s
  // of logit fits); the fitted models above are untouched by it.
  value.nested = nestedValueCheck(tradedDated, snapshot.as_of);
  odds.nested = nestedOddsCheck(peers, snapshot.as_of);
  const keptSet = new Set(value.kept_terms);
  const valueFit = fitValue(tradedDated, keptSet, snapshot.as_of, value.kept_shrink);
  const oddsFit = fitLogit(peers, odds.use, snapshot.as_of, 500);

  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable protocol the watchlist leaves out, above the floor as well as
  // below it. No cap: a board that stops at an arbitrary count hides the protocols it exists to find.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const ifLaunch = 10 ** valueFit(p);
    const tokenOdds = predictLogit(oddsFit, p, odds.use, snapshot.as_of);
    const implied = Math.max(1, Math.round(ifLaunch * tokenOdds));
    return { p, ifLaunch, tokenOdds, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    const p25 = Math.max(1, Math.round(s.ifLaunch * value.ranges.p25 * s.tokenOdds));
    const p75 = Math.max(1, Math.round(s.ifLaunch * value.ranges.p75 * s.tokenOdds));
    const sizeMultiple = s.ifLaunch / Math.max(s.p.tvl_usd, 1);
    // The odds-ratio contributions of this row's age and growth vs the peer mean: exp(w·z),
    // where w is the fitted logistic weight and z the standardised feature. A feature the
    // kept set does not use has weight 0, so its factor is exactly 1.
    const wAge = odds.use.indexOf(0) >= 0 ? oddsFit.weights[odds.use.indexOf(0) + 1]! : 0;
    const wGrowth = odds.use.indexOf(2) >= 0 ? oddsFit.weights[odds.use.indexOf(2) + 1]! : 0;
    const factorAge = Math.exp(wAge * ((ageYears(s.p, snapshot.as_of) - oddsFit.means[0]!) / oddsFit.sds[0]!));
    const factorGrowth = Math.exp(wGrowth * ((growthPct(s.p) - oddsFit.means[2]!) / oddsFit.sds[2]!));
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      age_days: age,
      implied_value_usd: s.implied,
      if_launch_usd: Math.max(1, Math.round(s.ifLaunch)),
      token_odds: round4(s.tokenOdds),
      implied_p25_usd: p25,
      implied_p75_usd: p75,
      model: {
        size_multiple: round4(sizeMultiple),
        size_intercept: value.fit.intercept,
        size_slope: value.fit.slope,
        odds_intercept: round4(oddsFit.weights[0]!),
        odds_age_weight: odds.use.indexOf(0) >= 0 ? round4(oddsFit.weights[odds.use.indexOf(0) + 1]!) : 0,
        age_years: round4(ageYears(s.p, snapshot.as_of)),
        family: familyOf(s.p),
        family_rate: round4(oddsFit.famRate.get(familyOf(s.p)) ?? oddsFit.baseRate),
        factor_age: round4(factorAge),
        factor_growth: round4(factorGrowth),
      },
      farm: farmEconomics(s.p, s.implied),
      farm_steps: farmSteps(s.p, age).map(stepText),
    };
  });
  const accounting = accountFor(snapshot, new Set(board.map((r) => r.slug)));
  return { board, value, odds, accounting };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs: 0.02% of TVL, floored at $50, capped at $5,000. */
function capitalFor(p: SnapshotProtocol): number {
  return Math.max(FARM_DEFAULTS.plan_floor, Math.min(FARM_DEFAULTS.plan_share * p.tvl_usd, FARM_DEFAULTS.plan_cap));
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's primary action, in the words a farmer can follow. */
function primaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the position staked.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second action: a different feature of the same protocol, so the wallet shows depth. */
function secondaryAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const half = Math.max(10, Math.floor(capital / 2));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${half} against the supply on ${name}, then repay it within the week so the account shows both sides.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Swap $${half} through ${name}'s pool on ${chain} once a week so the address shows trading as well as liquidity.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Use the bridged funds in an app on ${chain} instead of bridging straight back, so the transfer reads as real use.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the receipt once more through ${name} if it offers a restaking route, and keep the new receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close and reopen the hedge once a week with a small size, keeping the margin in place.`;
  if (c.includes('prediction')) return `Settle one market a week on ${name} and keep each stake small.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Move $${half} into a second ${name} vault on ${chain} so the account holds more than one position.`;
  if (c.includes('stable')) return `Hold the stable asset in ${name}'s own savings route for a full week before moving it.`;
  if (c.includes('rwa')) return `Reinvest the yield once a month rather than withdrawing it, so the balance compounds.`;
  if (c.includes('insurance')) return `Renew or extend the cover before it lapses, so the policy never gaps.`;
  if (c.includes('farm')) return `Claim the farm rewards weekly and restake them instead of selling them.`;
  return `Use a second feature of ${name} once a week, such as a swap, a vote or another deposit.`;
}

/**
 * A protocol's farm plan: eight steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  const crossChain: FarmStep =
    secondChain !== null
      ? {
          text: `Repeat the position on ${secondChain} with half the capital, so the wallet is active on both of ${p.name}'s chains.`,
          cost: `$${Math.max(10, Math.floor(capital / 2))} of capital and about $3 of gas`,
          time: '15 minutes',
        }
      : {
          text: `Open a second position type inside ${p.name} on ${chain}, so the wallet shows more than one kind of activity.`,
          cost: `$${Math.max(10, Math.floor(capital / 2))} of capital and about $3 of gas`,
          time: '15 minutes',
        };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: primaryAction(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondaryAction(p, capital, chain),
      cost: `about $${capital >= 150 ? 5 : 3} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, and never leave the wallet idle for a whole month.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    crossChain,
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes; never pay anyone to claim for you.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it cleanly.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan carried whole. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: watchlist.has(row.slug),
    implied_value_usd: row.implied_value_usd,
    if_launch_usd: row.if_launch_usd,
    token_odds: row.token_odds,
    implied_p25_usd: row.implied_p25_usd,
    implied_p75_usd: row.implied_p75_usd,
    size_multiple: row.model.size_multiple,
    family: row.model.family,
    family_rate: row.model.family_rate,
    factor_age: row.model.factor_age,
    factor_growth: row.model.factor_growth,
    farm: row.farm,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; value: ValueModel; odds: OddsModel; accounting: Accounting } {
  const { board, value, odds, accounting } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const market7d = median(board.map((r) => r.change_7d).filter((v): v is number => v !== null), 0);
  const farm = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) {
    if (r.farm.verdict === 'FARM') farm.farm++;
    else if (r.farm.verdict === 'THIN') farm.thin++;
    else farm.skip++;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    market_7d: round4(market7d),
    value,
    odds,
    accounting,
    farm,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar, value, odds, accounting };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (!(r.token_odds >= 0 && r.token_odds <= 1)) return `${r.slug} has token odds ${r.token_odds}`;
    if (!(r.implied_p25_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_p75_usd)) return `${r.slug} has a range that does not contain its implied value`;
    if (!Number.isSafeInteger(r.if_launch_usd) || r.if_launch_usd <= 0) return `${r.slug} has if-launch value ${r.if_launch_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
