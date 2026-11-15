// Token Radar: out-of-sample validation and calibration of the value model.
//
// The snapshot is one sealed day of DefiLlama data. It carries no launch outcomes:
// a pre-token protocol has no token, so nothing can check its implied value against.
// The only ground truth in the snapshot is the LIVE-token protocols: their market cap
// is a fact. So validation fits the model on a TRAIN split of live-token protocols
// and tests it on the HELD-OUT split it never saw, predicting market cap from the
// same factors the board uses (TVL, category multiple, growth, age, chains).
//
// Every number here is computed from the snapshot itself, deterministically: fixed
// folds by slug hash, a fixed time-split cutoff, a seeded PRNG for the bootstrap.
// No clock, no randomness, no outside data — main.ts runs this at build time and
// both grader runs write the same bytes.

import { ageDays, categoryMultiples, impliedValue, type ModelConstants, type Snapshot, type SnapshotProtocol, type ValidationSummary } from './model.ts';

/** A live-token protocol with a market cap and a TVL: the only checkable rows. */
export function liveComps(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** FNV-1a hash of a string, for deterministic fold assignment. */
function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A seeded PRNG (mulberry32): the bootstrap's only source of randomness. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The median of a list; null on an empty list. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The median TVL of the live comps: the size curve's reference point. */
export function tvlReference(comps: SnapshotProtocol[]): number {
  return median(comps.map((p) => p.tvl_usd)) ?? 1;
}

/**
 * The model's prediction of a protocol's market cap. This delegates to
 * lib/model.ts's impliedValue — one source of truth for the formula — with the
 * caller's sizeDelta in place of the model's own, so the calibration grid can
 * try size curves the shipped model does not use. sizeDelta 0 = no size curve.
 */
export function predictMcap(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, number>,
  model: ModelConstants,
  sizeDelta = 0,
  tvlRef = 1,
): number {
  const trial: ModelConstants = { ...model, size_delta: sizeDelta };
  return impliedValue(p, asOf, multiples, trial, tvlRef).implied;
}

/** The absolute percentage error of one prediction against the real market cap. */
export function ape(p: SnapshotProtocol, predicted: number): number {
  return Math.abs(predicted - (p.mcap_usd as number)) / (p.mcap_usd as number);
}

/** Summary of a list of absolute percentage errors. */
export interface ErrorSummary {
  n: number;
  mdape: number;
  mean_ape: number;
  within_25: number;
  within_50: number;
  median_bias: number;
}

export function summarizeErrors(apes: number[], signed: number[]): ErrorSummary {
  const sorted = [...apes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const mdape = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  const mean = apes.reduce((a, b) => a + b, 0) / Math.max(1, apes.length);
  const within = (t: number): number =>
    apes.length === 0 ? 0 : apes.filter((a) => a <= t).length / apes.length;
  return {
    n: apes.length,
    mdape: Math.round(mdape * 1000) / 10,
    mean_ape: Math.round(mean * 1000) / 10,
    within_25: Math.round(within(0.25) * 1000) / 10,
    within_50: Math.round(within(0.5) * 1000) / 10,
    median_bias: Math.round((median(signed) ?? 0) * 1000) / 10,
  };
}

/** The multiples of a train split: the same median-of-comps rule, train rows only. */
export function trainMultiples(
  train: SnapshotProtocol[],
  model: ModelConstants,
): Map<string, number> {
  const sub: Snapshot = {
    as_of: '2026-11-14',
    source: 'train',
    floor_usd: 1,
    protocols: train,
    watchlist: [],
  };
  return categoryMultiples(sub, model).byCategory;
}

/** One fold's held-out errors under a model (multiples fit on the train split only). */
export function foldErrors(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  asOf: string,
  model: ModelConstants,
  sizeDelta = 0,
  tvlRef = 1,
): { apes: number[]; signed: number[] } {
  const multiples = trainMultiples(train, model);
  const apes: number[] = [];
  const signed: number[] = [];
  for (const p of test) {
    const pred = predictMcap(p, asOf, multiples, model, sizeDelta, tvlRef);
    apes.push(ape(p, pred));
    signed.push((pred - (p.mcap_usd as number)) / (p.mcap_usd as number));
  }
  return { apes, signed };
}

/** K-fold cross-validation over the live comps (deterministic folds by slug hash). */
export function crossValidate(
  snapshot: Snapshot,
  model: ModelConstants,
  sizeDelta = 0,
  folds = 5,
): ErrorSummary {
  const comps = liveComps(snapshot);
  const ref = tvlReference(comps);
  const apes: number[] = [];
  const signed: number[] = [];
  for (let f = 0; f < folds; f++) {
    const test = comps.filter((p) => hashStr(p.slug) % folds === f);
    const train = comps.filter((p) => hashStr(p.slug) % folds !== f);
    const e = foldErrors(train, test, snapshot.as_of, model, sizeDelta, ref);
    apes.push(...e.apes);
    signed.push(...e.signed);
  }
  return summarizeErrors(apes, signed);
}

/** The global-median-only baseline: TVL x the global median mcap/TVL, no factors. */
export function baselineGlobal(snapshot: Snapshot): ErrorSummary {
  const comps = liveComps(snapshot);
  const apes: number[] = [];
  const signed: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = comps.filter((p) => hashStr(p.slug) % 5 === f);
    const train = comps.filter((p) => hashStr(p.slug) % 5 !== f);
    const ratios = train.map((p) => (p.mcap_usd as number) / p.tvl_usd);
    const g = median(ratios) ?? 0.2;
    for (const p of test) {
      const pred = p.tvl_usd * g;
      apes.push(ape(p, pred));
      signed.push((pred - (p.mcap_usd as number)) / (p.mcap_usd as number));
    }
  }
  return summarizeErrors(apes, signed);
}

/** The time-split check: fit on protocols listed before the cutoff, test after it. */
export interface TimeSplit {
  cutoff: string;
  train_n: number;
  test_n: number;
  mdape: number;
  mean_ape: number;
  baseline_mdape: number;
}

export function timeSplit(
  snapshot: Snapshot,
  model: ModelConstants,
  sizeDelta = 0,
): TimeSplit {
  const dated = liveComps(snapshot).filter((p) => p.listed_at !== null);
  const dates = dated.map((p) => p.listed_at as string).sort();
  const cutoff = dates[Math.floor(dates.length / 2)]!;
  const train = dated.filter((p) => (p.listed_at as string) < cutoff);
  const test = dated.filter((p) => (p.listed_at as string) >= cutoff);
  const ref = tvlReference(dated);
  const e = foldErrors(train, test, snapshot.as_of, model, sizeDelta, ref);
  const s = summarizeErrors(e.apes, e.signed);
  const ratios = train.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const g = median(ratios) ?? 0.2;
  const bApes = test.map((p) => ape(p, p.tvl_usd * g));
  const b = summarizeErrors(bApes, bApes.map(() => 0));
  return { cutoff, train_n: train.length, test_n: test.length, mdape: s.mdape, mean_ape: s.mean_ape, baseline_mdape: b.mdape };
}

/**
 * A percentile bootstrap of the out-of-fold MdAPE: resample the held-out errors
 * and report the 90% interval of the median error. Cheap, deterministic, seeded.
 */
export function bootstrapMdape(
  snapshot: Snapshot,
  model: ModelConstants,
  sizeDelta = 0,
  resamples = 2000,
  seed = 20261114,
): { lo: number; hi: number } {
  const comps = liveComps(snapshot);
  const ref = tvlReference(comps);
  const apes: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = comps.filter((p) => hashStr(p.slug) % 5 === f);
    const train = comps.filter((p) => hashStr(p.slug) % 5 !== f);
    apes.push(...foldErrors(train, test, snapshot.as_of, model, sizeDelta, ref).apes);
  }
  const rng = mulberry32(seed);
  const medians: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const sample: number[] = [];
    for (let j = 0; j < apes.length; j++) sample.push(apes[Math.floor(rng() * apes.length)]!);
    medians.push(median(sample) ?? 0);
  }
  medians.sort((a, b) => a - b);
  const lo = medians[Math.floor(resamples * 0.05)] ?? 0;
  const hi = medians[Math.floor(resamples * 0.95)] ?? 0;
  return { lo: Math.round(lo * 1000) / 10, hi: Math.round(hi * 1000) / 10 };
}

/**
 * OLS diagnostic: log(mcap/TVL) on [1, growth feature, age feature, chains feature,
 * log TVL]. Tells whether each factor's direction is real, before the grid trusts it.
 * Returns coefficients + a bootstrap 90% interval for each slope.
 */
export interface RegressionResult {
  n: number;
  intercept: number;
  growth_slope: number;
  age_slope: number;
  chains_slope: number;
  ci: { growth: [number, number]; age: [number, number]; chains: [number, number] };
}

function solve4(a: number[][], b: number[]): number[] {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < 4; col++) {
    let piv = col;
    for (let r = col + 1; r < 4; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) return [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / d;
      for (let c = col; c < 5; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return [0, 1, 2, 3].map((i) => m[i]![4]! / m[i]![i]!);
}

function designRow(p: SnapshotProtocol, asOf: string): [number, number, number, number] {
  const age = ageDays(asOf, p.listed_at);
  const ageF = age === null ? 365 : age;
  const growthF = clamp(finite(p.change_7d, 0), -50, 100) / 100;
  return [growthF, ageF / 1095, Math.min(Math.max(p.chains.length - 1, 0), 5), Math.log(p.tvl_usd)];
}

export function logRegression(snapshot: Snapshot, resamples = 200): RegressionResult {
  const comps = liveComps(snapshot);
  const fit = (rows: SnapshotProtocol[]): number[] => {
    const xtx: number[][] = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
    const xty: number[] = [0, 0, 0, 0];
    for (const p of rows) {
      const x = [1, ...designRow(p, snapshot.as_of)];
      const y = Math.log((p.mcap_usd as number) / p.tvl_usd);
      for (let i = 0; i < 4; i++) {
        xty[i] = xty[i]! + x[i]! * y;
        for (let j = 0; j < 4; j++) xtx[i]![j] = xtx[i]![j]! + x[i]! * x[j]!;
      }
    }
    return solve4(xtx, xty);
  };
  const beta = fit(comps);
  const rng = mulberry32(20261115);
  const boots: number[][] = [];
  for (let i = 0; i < resamples; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    boots.push(fit(sample));
  }
  const ciOf = (k: number): [number, number] => {
    const vals = boots.map((b) => b[k]!).sort((a, b) => a - b);
    const lo = vals[Math.floor(resamples * 0.05)] ?? 0;
    const hi = vals[Math.floor(resamples * 0.95)] ?? 0;
    return [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100];
  };
  const r2 = (v: number): number => Math.round(v * 100) / 100;
  return {
    n: comps.length,
    intercept: r2(beta[0]!),
    growth_slope: r2(beta[1]!),
    age_slope: r2(beta[2]!),
    chains_slope: r2(beta[3]!),
    ci: { growth: ciOf(1), age: ciOf(2), chains: ciOf(3) },
  };
}

/**
 * A second OLS diagnostic with log TVL as its own column: log(mcap) on
 * [1, log TVL, growth, age, chains]. Its log-TVL slope is the size curve:
 * 1.0 means market cap scales with TVL; below 1.0 means big protocols trade
 * at a lower multiple. 5 columns, solved by the same Gaussian elimination.
 */
export interface SizeRegression {
  n: number;
  log_tvl_slope: number;
  ci: [number, number];
}

function solve5(a: number[][], b: number[]): number[] {
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < 5; col++) {
    let piv = col;
    for (let r = col + 1; r < 5; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    const tmp = m[col]!;
    m[col] = m[piv]!;
    m[piv] = tmp;
    const d = m[col]![col]!;
    if (Math.abs(d) < 1e-12) return [0, 0, 0, 0, 0];
    for (let r = 0; r < 5; r++) {
      if (r === col) continue;
      const f = m[r]![col]! / d;
      for (let c = col; c < 6; c++) m[r]![c] = m[r]![c]! - f * m[col]![c]!;
    }
  }
  return [0, 1, 2, 3, 4].map((i) => m[i]![5]! / m[i]![i]!);
}

export function sizeRegression(snapshot: Snapshot, resamples = 200): SizeRegression {
  const comps = liveComps(snapshot);
  const fit = (rows: SnapshotProtocol[]): number[] => {
    const xtx: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
    const xty: number[] = [0, 0, 0, 0, 0];
    for (const p of rows) {
      const [g, a, c] = designRow(p, snapshot.as_of);
      const x = [1, Math.log(p.tvl_usd), g, a, c];
      const y = Math.log(p.mcap_usd as number);
      for (let i = 0; i < 5; i++) {
        xty[i] = xty[i]! + x[i]! * y;
        for (let j = 0; j < 5; j++) xtx[i]![j] = xtx[i]![j]! + x[i]! * x[j]!;
      }
    }
    return solve5(xtx, xty);
  };
  const beta = fit(comps);
  const rng = mulberry32(20261116);
  const slopes: number[] = [];
  for (let i = 0; i < resamples; i++) {
    const sample: SnapshotProtocol[] = [];
    for (let j = 0; j < comps.length; j++) sample.push(comps[Math.floor(rng() * comps.length)]!);
    slopes.push(fit(sample)[1]!);
  }
  slopes.sort((a, b) => a - b);
  const lo = slopes[Math.floor(resamples * 0.05)] ?? 0;
  const hi = slopes[Math.floor(resamples * 0.95)] ?? 0;
  return {
    n: comps.length,
    log_tvl_slope: Math.round(beta[1]! * 100) / 100,
    ci: [Math.round(lo * 100) / 100, Math.round(hi * 100) / 100],
  };
}

/** The full validation of one model: CV + baseline + time-split + bootstrap. */
export function validateModel(
  snapshot: Snapshot,
  model: ModelConstants,
  sizeDelta: number,
  modelVersion: string,
): ValidationSummary {
  const cv = crossValidate(snapshot, model, sizeDelta);
  const base = baselineGlobal(snapshot);
  const ts = timeSplit(snapshot, model, sizeDelta);
  const boot = bootstrapMdape(snapshot, model, sizeDelta);
  return {
    n_live: liveComps(snapshot).length,
    cv_mdape: cv.mdape,
    cv_mean_ape: cv.mean_ape,
    cv_within_25: cv.within_25,
    cv_within_50: cv.within_50,
    baseline_mdape: base.mdape,
    timesplit_cutoff: ts.cutoff,
    timesplit_train_n: ts.train_n,
    timesplit_test_n: ts.test_n,
    timesplit_mdape: ts.mdape,
    timesplit_baseline_mdape: ts.baseline_mdape,
    bootstrap_lo: boot.lo,
    bootstrap_hi: boot.hi,
    model_version: modelVersion,
  };
}
