// Token Radar, model radar-3: one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot carries (the 40 watchlist slugs are the
// floor, never the ceiling; the early radar adds every other rankable protocol below the floor).
// A protocol is pre-token when its record carries no token: no market cap, no CoinGecko id, no
// symbol. Protocols whose token already trades are kept apart and shown with the market's own
// values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, in five factors:
//
//   category multiple = the category's own live-market multiple: the median mcap / TVL of the
//                         live-token protocols in the same category (this snapshot, at least 5
//                         of them), otherwise the global median; clamped to [0.05, 1.50].
//                         A category whose live tokens trade rich against TVL earns a richer
//                         multiple; a category with too few live comps borrows the global one.
//   growth            = 1 + clamp(change_7d, -50, 100) / 100 * 0.8
//   maturity          = 1.0 + min(age_days, 1095) / 1095 * -0.25   (unknown age: 365 days)
//                         Older with no token is worth LESS, not more: the calibration found
//                         age carries no positive signal, and a protocol that has run for
//                         years without issuing a token is the one least likely to launch rich.
//   breadth           = 1 + 0 * min(chains - 1, 5)   (tested, zero weight: chains carry no
//                         signal in this snapshot, so the factor is 1 and stays visible)
//   size              = (tvl_usd / size_reference) ^ -0.4   (size_reference = median TVL of
//                         the snapshot's live-token protocols). Market cap scales as TVL^0.52
//                         in this snapshot, not TVL^1: big protocols trade at a much lower
//                         multiple, so the size curve bends big TVLs down and small ones up.
//
//   implied = max(1, round(tvl_usd * category_multiple * growth * maturity * breadth * size))
//
// The weights are NOT hand-picked: lib/validate.ts fits them on TRAIN splits of the
// snapshot's live-token protocols only and tests them on held-out splits it never saw
// (5-fold cross-validation, a time-split, a 2,000-resample bootstrap). The dashboard
// prints the validation numbers, so a reader can check the model's error by hand.
// No protocol name is ever special-cased: the same function scores every row, and the
// dashboard prints the formula and the category multiples it used, so a reader can
// check any row by hand.

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

/** The model's constants, as the dashboard states them. radar-3's weights are the
 * ones the out-of-sample calibration in lib/validate.ts fitted on TRAIN splits of
 * the snapshot's live-token protocols only (see validation-report.json):
 * growth 0.8, maturity falling with age (older with no token is worth less, not
 * more), breadth 0 (chains carry no signal in this snapshot), and a size curve
 * (market cap scales as TVL^0.52, so big protocols trade at a lower multiple). */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_max: number;
  multiple_floor: number;
  multiple_cap: number;
  multiple_min_live: number;
  size_delta: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 1.0,
  maturity_range: -0.25,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0,
  breadth_max: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  multiple_min_live: 5,
  size_delta: -0.4,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
  launch_note: string | null;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    size_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
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
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  size_multiplier: number;
  launch_note: string | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's derived multiple, for the dashboard's model panel. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  live_count: number;
  from_global: boolean;
}

/** The out-of-sample validation of one model, computed from the snapshot alone
 * (lib/validate.ts): the numbers the dashboard's validation panel prints. */
export interface ValidationSummary {
  n_live: number;
  cv_mdape: number;
  cv_mean_ape: number;
  cv_within_25: number;
  cv_within_50: number;
  baseline_mdape: number;
  timesplit_cutoff: string;
  timesplit_train_n: number;
  timesplit_test_n: number;
  timesplit_mdape: number;
  timesplit_baseline_mdape: number;
  bootstrap_lo: number;
  bootstrap_hi: number;
  model_version: string;
}

/** Everything the dashboard needs: the board, the live set, the model and its multiples. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  size_reference_tvl: number;
  validation: ValidationSummary | null;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_implied_usd: number;
  multiples: CategoryMultiple[];
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a sorted copy; null on an empty list. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Categories the house's watchlist rule leaves out: a wrapped, staked or bridged product of a
 * token that already trades is not a protocol still waiting on a launch of its own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names beginning with an exchange's name are that exchange's product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** A name carrying a whole word wrapped, staked or staking is a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and none of the house watchlist rule's
 * exclusions — not a wrapped, staked or bridged product, not an exchange's product, not a
 * versioned pool. WBTC is Bitcoin on Ethereum and a bridge is a road, not a launch: the board's
 * top must be protocols that could actually issue a token of their own.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The category multiples, derived from the snapshot's own live-token protocols: for each category
 * with at least `multiple_min_live` live protocols carrying a market cap and a TVL, the median of
 * their mcap / TVL; every other category borrows the global median. All multiples are clamped to
 * [multiple_floor, multiple_cap] so one outlier comp cannot set a category's price.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, number>; table: CategoryMultiple[]; global: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of live) {
    const ratio = (p.mcap_usd as number) / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const c = p.category ?? 'Other';
    const list = byCat.get(c) ?? [];
    list.push(ratio);
    byCat.set(c, list);
  }
  const global = clamp(median(all) ?? 0.2, model.multiple_floor, model.multiple_cap);
  const byCategory = new Map<string, number>();
  const table: CategoryMultiple[] = [];
  const categories = new Set(snapshot.protocols.map((p) => p.category ?? 'Other'));
  for (const c of [...categories].sort()) {
    const list = byCat.get(c) ?? [];
    if (list.length >= model.multiple_min_live) {
      const m = clamp(median(list) ?? global, model.multiple_floor, model.multiple_cap);
      byCategory.set(c, m);
      table.push({ category: c, multiple: round3(m), live_count: list.length, from_global: false });
    } else {
      byCategory.set(c, global);
      table.push({ category: c, multiple: round3(global), live_count: list.length, from_global: true });
    }
  }
  return { byCategory, table, global };
}

const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The four factors and the implied value one protocol gets under `model`.
 * `sizeRef` is required, never defaulted: with a nonzero size_delta, a missing
 * reference would bend every TVL around 1 dollar and collapse the values. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  model: ModelConstants,
  sizeRef: number,
): { implied: number; categoryMultiple: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; sizeMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const categoryMultiple = multiples.get(protocol.category ?? 'Other') ?? 0.2;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max);
  const sizeMult = model.size_delta === 0 ? 1 : Math.pow(protocol.tvl_usd / sizeRef, model.size_delta);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * categoryMultiple * growthMult * maturityMult * breadthMult * sizeMult));
  return { implied, categoryMultiple, growthPct, growthMult, maturityMult, breadthMult, sizeMult, age };
}

/** The size curve's reference point: the median TVL of the snapshot's live-token
 * protocols (market cap and TVL both positive). At this TVL the size factor is 1. */
export function sizeReference(snapshot: Snapshot): number {
  const tvls = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .map((p) => p.tvl_usd)
    .sort((a, b) => a - b);
  if (tvls.length === 0) return 1;
  const mid = Math.floor(tvls.length / 2);
  return tvls.length % 2 === 1 ? tvls[mid]! : Math.round((tvls[mid - 1]! + tvls[mid]!) / 2);
}

/**
 * A model note for a row whose category borrows the global multiple: too few live-token
 * protocols in that category carry a market cap to price the category on its own. Null when the
 * category has its own multiple. The note is honest about where the number comes from.
 */
export function launchNote(p: SnapshotProtocol, table: CategoryMultiple[]): string | null {
  const entry = table.find((t) => t.category === (p.category ?? 'Other'));
  if (entry !== undefined && entry.from_global) {
    return `Priced on the global median multiple: only ${entry.live_count} live-token protocol${entry.live_count === 1 ? '' : 's'} in ${entry.category} carry a market cap, too few to price this category on its own.`;
  }
  return null;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, table } = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. No hand-picked list:
  // the radar exists to find the early ones, and the watchlist rule's exclusions already keep
  // the wrapped, staked and bridged products out.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, byCategory, model, sizeReference(snapshot));
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    launch_note: launchNote(s.p, table),
    model: {
      category_multiple: s.categoryMultiple,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      size_multiplier: round4(s.sizeMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
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

/** The gas token a chain settles fees in, by the chain's own name. */
function gasToken(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 'SOL';
  if (c.includes('bnb') || c.includes('binance') || c.includes('bsc')) return 'BNB';
  if (c.includes('avalanche') || c.includes('avax')) return 'AVAX';
  if (c.includes('polygon')) return 'POL';
  if (c.includes('fantom')) return 'FTM';
  if (c.includes('gnosis')) return 'xDAI';
  if (c.includes('cronos')) return 'CRO';
  if (c.includes('tron')) return 'TRX';
  if (c.includes('aptos')) return 'APT';
  if (c.includes('sui')) return 'SUI';
  if (c.includes('near')) return 'NEAR';
  if (c.includes('cosmos') || c.includes('osmosis')) return 'ATOM';
  if (c.includes('hyperliquid')) return 'HYPE';
  if (c.includes('arbitrum') || c.includes('optimism') || c.includes('base') || c.includes('zksync') || c.includes('linea') || c.includes('scroll') || c.includes('blast') || c.includes('ethereum')) return 'ETH';
  return 'the chain\u2019s gas token';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string, gas: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('risk curator') || c.includes('curator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain}; the curator allocates it across its strategies and the vault receipt is your position.`;
  if (c.includes('capital allocator') || c.includes('allocator')) return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and hold the vault shares; the allocator routes the capital and your shares are the record.`;
  if (c.includes('basis trading')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the vault shares through one full funding cycle.`;
  if (c.includes('leveraged farm')) return `Open a leveraged farm on ${name} with $${capital} of collateral on ${chain} and keep the loan-to-value below the liquidation line.`;
  if (c.includes('uncollateralized lending')) return `Lend $${capital} of USDC through ${name} on ${chain} and keep the loan open; the borrower record is your position.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both legs open.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in its narrowest active range and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s top vault on ${chain} and let the aggregator rotate it; your vault shares are the record.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-yield strategy on ${chain} and keep the position open.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app instead of bridging them straight back.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token; do not sell the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} on ${chain}, open one small hedge, and keep the position open for a week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market that settles after this week.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own vault.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; the mint receipt is your position.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it; the basket is your position.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} this week and keep every receipt.`;
  if (c.includes('farm')) return `Deposit $${capital} into ${name}'s farm on ${chain} and keep the LP tokens staked for the full period.`;
  if (c.includes('chain')) return `Bridge $${capital} onto ${name}'s chain, use its native apps for one swap and one deposit, and hold the position on the chain itself.`;
  if (c.includes('interest rate')) return `Open a $${capital} fixed-rate position on ${name} on ${chain} and hold it to maturity.`;
  if (c.includes('otc')) return `Place one $${capital} OTC quote through ${name} on ${chain} and settle it on the protocol, not off it.`;
  if (c.includes('governance')) return `Lock $${capital} in ${name}'s governance on ${chain} and vote once while the lock is active.`;
  if (c.includes('card')) return `Spend $${capital} through ${name}'s card on ${chain} and keep the spend inside the protocol's own rewards program.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open; pay the gas in ${gas}.`;
}

/** The category's second qualifying action, a different leg from the first. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return `Borrow $${small} against the position and use the borrowed funds inside ${name}'s own market, not elsewhere.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Swap $${small} through ${name}'s pool once a week so the router records activity on your wallet.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${small} back the following week so the route records a round trip on your wallet.`;
  if (c.includes('liquid staking') || c.includes('restak') || c.includes('staking pool')) return `Restake the receipt token once, if ${name} offers it, so two layers of activity sit on the same wallet.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield aggregator') || c.includes('yield')) return `Deposit a second, smaller tranche of $${small} after the first week so the vault records two entries on your wallet.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Close and reopen the hedge once so the book records two trades instead of one.`;
  if (c.includes('prediction')) return `Place a second $${small} position on a different market so the book records two outcomes.`;
  if (c.includes('rwa') || c.includes('stable') || c.includes('index')) return `Add $${small} more to the same position after a week so the ledger records a second deposit.`;
  return `Vote once in ${name}'s governance, or join its points program, and keep the receipt on the same wallet.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Every step names what it costs and how long it takes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasToken(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gasFee = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `under $3 of gas in ${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain, gas),
      cost: `$${capital} of capital and about $${gasFee} of gas in ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain),
      cost: `about $${Math.max(10, Math.round(capital / 5))} of capital and about $2 of gas in ${gas}`,
      time: '10 minutes',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $2 of gas in ${gas} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
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

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
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
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    size_multiplier: row.model.size_multiplier,
    launch_note: row.launch_note,
  };
}

/** Everything the dashboard renders, from the snapshot. `validation` is filled in
 * by main.ts (lib/validate.ts): the out-of-sample numbers for this model. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const { table } = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const total = board.reduce((n, r) => n + r.implied_value_usd, 0);
  const sorted = [...board].map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const medianValue = sorted.length % 2 === 1 ? sorted[Math.floor(sorted.length / 2)]! : Math.round((sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    size_reference_tvl: sizeReference(snapshot),
    validation: null,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: total,
    median_implied_usd: medianValue,
    multiples: table,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
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
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
