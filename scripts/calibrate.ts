// Token Radar calibration, run once by hand (node scripts/calibrate.ts):
// fits the model's weights on TRAIN splits of the live-token protocols only and
// reports the held-out error. This script is NOT run by main.ts: main.ts only
// validates the fixed, calibrated constants. Nothing here touches the network.

import { readFileSync, writeFileSync } from 'node:fs';
import {
  MODEL,
  ageDays,
  categoryMultiples,
  impliedValue,
  parseSnapshot,
  type ModelConstants,
  type Snapshot,
  type SnapshotProtocol,
} from '../lib/model.ts';
import {
  baselineGlobal,
  bootstrapMdape,
  crossValidate,
  liveComps,
  logRegression,
  predictMcap,
  sizeRegression,
  timeSplit,
  trainMultiples,
  tvlReference,
} from '../lib/validate.ts';

const snapshot: Snapshot = parseSnapshot(
  readFileSync(new URL('../../token-radar-01-kit/input/snapshot.json', import.meta.url), 'utf8'),
);
const comps = liveComps(snapshot);
const ref = tvlReference(comps);

// The OLD constants (radar-2), frozen here so the old-vs-new comparison stays
// honest now that MODEL in lib/model.ts is radar-3.
const RADAR2: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.04,
  breadth_max: 5,
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  multiple_min_live: 3,
  size_delta: 0,
};

// --- 0. Mirror check: predictMcap with the model's own sizeDelta must equal
// impliedValue exactly (it delegates to it). Any mismatch is a formula drift bug.
let mirrorBad = 0;
{
  const { byCategory } = categoryMultiples(snapshot, MODEL);
  for (const p of comps) {
    const a = impliedValue(p, snapshot.as_of, byCategory, MODEL, ref).implied;
    const b = predictMcap(p, snapshot.as_of, byCategory, MODEL, MODEL.size_delta, ref);
    if (Math.abs(a - Math.round(b)) > 1) mirrorBad++;
  }
}
console.log(`mirror check: predictMcap vs impliedValue, mismatches: ${mirrorBad} of ${comps.length}`);

// --- 1. Diagnostics: what does the data itself say about each factor?
console.log('\n--- log regression: log(mcap/TVL) on growth, age, chains (n=' + comps.length + ') ---');
const reg = logRegression(snapshot);
console.log(JSON.stringify(reg, null, 2));
console.log('\n--- size regression: log(mcap) on log(TVL) + growth + age + chains ---');
const size = sizeRegression(snapshot);
console.log(JSON.stringify(size, null, 2));

// --- 2. Baselines under the same protocol: 5-fold CV + time-split.
console.log('\n--- 5-fold CV (median APE %) ---');
console.log('global-median-only baseline:', JSON.stringify(baselineGlobal(snapshot)));
console.log('radar-2 (OLD constants):', JSON.stringify(crossValidate(snapshot, RADAR2, 0)));
console.log('\n--- time-split (fit before cutoff, test after) ---');
console.log('radar-2 (OLD):', JSON.stringify(timeSplit(snapshot, RADAR2, 0)));

// --- 3. Grid search: select params by 5-fold CV mean MdAPE (train folds only).
const GRID = {
  growth_weight: [0, 0.2, 0.4, 0.6, 0.8, 1.0],
  maturity_floor: [0.7, 0.85, 1.0],
  maturity_range: [-0.5, -0.25, 0, 0.25, 0.5],
  breadth_step: [0, 0.02, 0.04, 0.08],
  multiple_cap: [1.0, 1.5, 2.5],
  multiple_min_live: [2, 3, 5],
  size_delta: [0, -0.1, -0.2, -0.3, -0.4, -0.5],
};

interface Combo extends ModelConstants {}

function hashStr(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function apeOf(p: SnapshotProtocol, pred: number): number {
  return Math.abs(pred - (p.mcap_usd as number)) / (p.mcap_usd as number);
}

/** Mean fold-MdAPE of one combo over 5 deterministic folds of `rows`. */
function cvScore(rows: SnapshotProtocol[], combo: Combo, asOf: string): number {
  const r = tvlReference(rows);
  const foldMd: number[] = [];
  for (let f = 0; f < 5; f++) {
    const test = rows.filter((p) => hashStr(p.slug) % 5 === f);
    const train = rows.filter((p) => hashStr(p.slug) % 5 !== f);
    const mult = trainMultiples(train, combo);
    const apes = test.map((p) => apeOf(p, predictMcap(p, asOf, mult, combo, combo.size_delta, r)));
    foldMd.push(medianOf(apes) * 100);
  }
  return foldMd.reduce((a, b) => a + b, 0) / foldMd.length;
}

function gridSearch(rows: SnapshotProtocol[], asOf: string): { combo: Combo; score: number }[] {
  const out: { combo: Combo; score: number }[] = [];
  for (const gw of GRID.growth_weight)
    for (const mf of GRID.maturity_floor)
      for (const mr of GRID.maturity_range)
        for (const bs of GRID.breadth_step)
          for (const cap of GRID.multiple_cap)
            for (const ml of GRID.multiple_min_live)
              for (const sd of GRID.size_delta) {
                const combo: Combo = {
                  growth_weight: gw,
                  growth_floor: -50,
                  growth_cap: 100,
                  maturity_floor: mf,
                  maturity_range: mr,
                  maturity_days: 1095,
                  unknown_age_days: 365,
                  breadth_step: bs,
                  breadth_max: 5,
                  multiple_floor: 0.05,
                  multiple_cap: cap,
                  multiple_min_live: ml,
                  size_delta: sd,
                };
                out.push({ combo, score: cvScore(rows, combo, asOf) });
              }
  out.sort((a, b) => a.score - b.score);
  return out;
}

const t0 = Date.now();
const ranked = gridSearch(comps, snapshot.as_of);
console.log(`\ngrid search: ${ranked.length} combos in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('--- top 5 combos by 5-fold CV mean MdAPE ---');
for (const r of ranked.slice(0, 5)) console.log(JSON.stringify({ score: Math.round(r.score * 10) / 10, ...r.combo }));

const best = ranked[0]!.combo;
console.log('\n--- best combo, full evaluation ---');
console.log('CV:', JSON.stringify(crossValidate(snapshot, best, best.size_delta)));
console.log('time-split (params NOT reselected on test):', JSON.stringify(timeSplit(snapshot, best, best.size_delta)));
console.log('bootstrap 90% CI of MdAPE:', JSON.stringify(bootstrapMdape(snapshot, best, best.size_delta)));

// --- 3b. Size-only model: category multiples + size curve, all other factors flat.
// The regression said mcap scales as TVL^0.52, so this isolates the size curve.
const sizeOnly: Combo = {
  growth_weight: 0, growth_floor: -50, growth_cap: 100,
  maturity_floor: 1, maturity_range: 0, maturity_days: 1095, unknown_age_days: 365,
  breadth_step: 0, breadth_max: 5, multiple_floor: 0.05,
  multiple_cap: best.multiple_cap, multiple_min_live: best.multiple_min_live,
  size_delta: -0.48,
};
console.log('\n--- size-only model (factors flat, size delta -0.48 = TVL^0.52) ---');
console.log('CV:', JSON.stringify(crossValidate(snapshot, sizeOnly, sizeOnly.size_delta)));
console.log('time-split:', JSON.stringify(timeSplit(snapshot, sizeOnly, sizeOnly.size_delta)));
const sizeOnlyScore = cvScore(comps, sizeOnly, snapshot.as_of);
console.log(`size-only CV mean fold-MdAPE: ${Math.round(sizeOnlyScore * 10) / 10}% (best grid combo: ${Math.round(ranked[0]!.score * 10) / 10}%)`);

// --- 4. The clean check: select params on the pre-cutoff half only, test once after.
const dated = comps.filter((p) => p.listed_at !== null);
const dates = dated.map((p) => p.listed_at as string).sort();
const cutoff = dates[Math.floor(dates.length / 2)]!;
const pre = dated.filter((p) => (p.listed_at as string) < cutoff);
const post = dated.filter((p) => (p.listed_at as string) >= cutoff);
const preRanked = gridSearch(pre, snapshot.as_of);
const preBest = preRanked[0]!.combo;
const postMult = trainMultiples(pre, preBest);
const postApes = post.map((p) =>
  apeOf(p, predictMcap(p, snapshot.as_of, postMult, preBest, preBest.size_delta, tvlReference(dated))),
);
const postMdape = Math.round(medianOf(postApes) * 1000) / 10;
console.log('\n--- clean time-split: params selected on pre-cutoff data only ---');
console.log(`cutoff ${cutoff}, train ${pre.length}, test ${post.length}`);
console.log('params selected on train half:', JSON.stringify(preBest));
console.log(`held-out MdAPE on post-cutoff protocols: ${postMdape}%`);
// Same check for the OLD constants, for a fair comparison:
const oldMult = trainMultiples(pre, RADAR2);
const oldApes = post.map((p) => apeOf(p, predictMcap(p, snapshot.as_of, oldMult, RADAR2, 0, tvlReference(dated))));
console.log(`old radar-2 constants on the same held-out set: ${Math.round(medianOf(oldApes) * 1000) / 10}%`);

const report = {
  as_of: snapshot.as_of,
  n_live: comps.length,
  mirror_mismatches: mirrorBad,
  regression: reg,
  size_regression: size,
  baseline_cv: baselineGlobal(snapshot),
  radar2_cv: crossValidate(snapshot, RADAR2, 0),
  radar2_timesplit: timeSplit(snapshot, RADAR2, 0),
  best_combo: best,
  best_cv: crossValidate(snapshot, best, best.size_delta),
  best_timesplit: timeSplit(snapshot, best, best.size_delta),
  best_bootstrap: bootstrapMdape(snapshot, best, best.size_delta),
  size_only: {
    combo: sizeOnly,
    cv: crossValidate(snapshot, sizeOnly, sizeOnly.size_delta),
    timesplit: timeSplit(snapshot, sizeOnly, sizeOnly.size_delta),
    cv_mean_fold_mdape: Math.round(sizeOnlyScore * 10) / 10,
  },
  clean_timesplit: { cutoff, train_n: pre.length, test_n: post.length, best_combo: preBest, mdape: postMdape, radar2_mdape: Math.round(medianOf(oldApes) * 1000) / 10 },
  top5: ranked.slice(0, 5).map((r) => ({ score: Math.round(r.score * 10) / 10, combo: r.combo })),
};
writeFileSync(new URL('../validation-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
console.log('\nwrote validation-report.json');
