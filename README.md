# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xwJ09/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xwJ09/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for [make.fun's token-radar-01 bounty](https://make.fun/bounty/token-radar-01): a static dashboard that ranks pre-token protocols by implied value and shows how to farm each one.

## The model (radar-2)

A flat multiple would say every protocol's token is worth the same slice of its TVL. The snapshot itself says otherwise, so the model anchors on what the market already pays, category by category:

- **ratio(category)** — the median market-cap / TVL of the live-token protocols in that category, read off this same snapshot. A category with fewer than 3 live reporters takes the whole-market median (0.214x). Ratios are clamped to 0.05x–1.50x.
- **growth** — 1 + winsorised 7-day TVL change (−50% to +100%) × 0.5.
- **maturity** — 0.7 + 0.3 × √(min(age, 730 days) / 730); an unlisted age uses 365 days.
- **breadth** — 1 + 0.02 × min(chains, 8).

`implied = round(TVL × ratio × growth × maturity × breadth)`

No protocol name is special-cased. The board ranks all 198 protocols that pass the pre-token screen (no token on record, not an exchange, versioned pool, or wrapped/staked/bridged product of a traded token); the 144 the screen leaves out are listed in the dashboard's Screened-out view with the reason. Live-token protocols are set aside with their market caps shown, and their market-cap / TVL is what the model learns its ratios from.

## The dashboard

`dashboard/` is a static page with no network: search, category and chain filters, a watchlist-only toggle, sortable columns, a per-protocol detail view (model breakdown, why-this-rank, farm plan with costs and times), a live-token view, a screened-out view, and the model with its observed category ratios. Farm plans are derived from each protocol's own category, chains, TVL and age.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path to snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output directory. Screenshots are real renders of the dashboard: the board, a protocol's detail view, and a filtered view.
