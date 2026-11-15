# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/kydosonchain/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/kydosonchain/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token DeFi protocol by implied launch value: TVL times its category's own live-market multiple, adjusted for growth, age and chain breadth, with a concrete farm plan for each of the 197 rows.

## The model (radar-3)

`implied = TVL x category multiple x growth x maturity x breadth x size`

- Category multiple: median mcap / TVL of the category's live-token protocols (at least 5 of them), else the global median; clamped to [0.05, 1.50].
- Growth: `1 + clamp(change_7d, -50, 100) / 100 x 0.8`.
- Maturity: `1.0 + min(age_days, 1095) / 1095 x -0.25` — older with no token is worth less, not more.
- Breadth: `1 + 0 x min(chains - 1, 5)` — tested, zero weight.
- Size: `(tvl_usd / $32.6M) ^ -0.4` — market cap scales as TVL^0.52 in this snapshot, so big TVLs are bent down.

## Tested out of sample

The weights are fitted, not hand-picked (`scripts/calibrate.ts`, full numbers in `validation-report.json`). Ground truth is the snapshot's own 128 live-token protocols, whose market cap is a fact: the model predicts each one's market cap and the error is measured against the real number.

- 5-fold cross-validation: median error **88.5%** (naive global median multiple: 87.8%).
- Time-split (fit before 2024-02-18, test on the 48 listed after): median error **80.1%** (naive: 88.2%; old radar-2 weights: 95.4%).
- Clean check (weights selected on the pre-cutoff half only): **92.4%** vs 95.4% for the old weights.
- Bootstrap (2,000 resamples): 90% interval for the median error 79.3–92.2%.

Honest reading: the error is still large in absolute terms — a market cap is hard to pin from TVL alone, and the old weights were worse than a naive multiple on every check. The size curve is the one robust finding (log-log slope 0.52, 90% CI 0.39–0.70); growth, age and chains carry no signal beyond it on random splits.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=7grpysgr&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
