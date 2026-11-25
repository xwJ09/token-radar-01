// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board ranks every protocol that passes the pre-token screen: it records no token
// (no market cap, no CoinGecko id, no symbol) and is not an exchange, a versioned pool,
// or a wrapped, staked or bridged product of a token that already trades. The screen is
// the house's own watchlist rule, applied to the whole board instead of only the floor:
// a wrapped or staked product of a traded token is not a token that does not exist yet.
// Everything the screen leaves out is listed in the dashboard's Screened-out view, with
// the reason, so the radar shows its work instead of quietly dropping rows.
//
// Implied value is anchored on what the market already pays, category by category:
//
//   ratio(c)   = median market-cap / TVL of the live-token protocols in category c
//                (this same snapshot; at least 3 reporting both, else the whole-market
//                median; clamped to [0.05, 1.50])
//   growth     = 1 + clamp(change_7d, -50, +100) / 100 x 0.5
//   maturity   = 0.7 + 0.3 x sqrt(min(age_days, 730) / 730)   (age unknown: 365 days)
//   breadth    = 1 + 0.02 x min(chains, 8)
//   implied    = round(tvl_usd x ratio(c) x growth x maturity x breadth)
//
// A flat multiple would say every protocol's token is worth the same slice of its TVL.
// The snapshot itself says otherwise: live-token Dexs trade near 0.34x their TVL while
// live-token lending protocols sit near 0.13x, so the same TVL implies a different token.
// Growth is winsorised because one protocol in this snapshot grew 4,448% in a week and
// a raw read would let a single spike own the board. Maturity rises with the square
// root of age: a protocol that has run two years with no token has proved it can hold
// value, but the tenth year proves little more than the second. Breadth rewards the
// protocols that already run on several chains, because a launch reaches more users.
// No protocol name is ever special-cased: the same function scores every row.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  ratio_floor: number;
  ratio_cap: number;
  ratio_min_obs: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  ratio_floor: 0.05,
  ratio_cap: 1.5,
  ratio_min_obs: 3,
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 730,
  unknown_age_days: 365,
  breadth_per_chain: 0.02,
  breadth_max_chains: 8,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 40;

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
  model: {
    category_ratio: number;
    ratio_source: 'category' | 'market';
    ratio_obs: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
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
  category_ratio: number;
  ratio_source: 'category' | 'market';
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  farm_steps: string[];
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

/** One protocol the screen left out, and why. */
export interface ExcludedRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** One category's observed market-cap / TVL ratio, for the dashboard's model table. */
export interface CategoryRatio {
  category: string;
  ratio: number;
  observations: number;
  used: 'category' | 'market';
}

/** Everything the dashboard needs: the board, the live set, the screened-out set, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  market_ratio: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  excluded_size: number;
  category_ratios: CategoryRatio[];
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
  excluded: ExcludedRow[];
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

/** The median of a sorted list of numbers. */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The market's own ratios, read off this snapshot: for every category, the median
 * market-cap / TVL of its live-token protocols that report both, and the whole-market
 * median as the fallback. A category with fewer than `minObs` reporters is too thin
 * to speak for itself, so it takes the market median.
 */
export function categoryRatios(snapshot: Snapshot, model: ModelConstants = MODEL): { byCategory: Map<string, CategoryRatio>; market: number } {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const market = median(live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b));
  const byCat = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const list = byCat.get(key);
    if (list) list.push(p.mcap_usd! / p.tvl_usd);
    else byCat.set(key, [p.mcap_usd! / p.tvl_usd]);
  }
  const byCategory = new Map<string, CategoryRatio>();
  for (const [category, values] of byCat) {
    const obs = values.length;
    const raw = obs >= model.ratio_min_obs ? median(values.slice().sort((a, b) => a - b)) : market;
    const ratio = Math.min(model.ratio_cap, Math.max(model.ratio_floor, raw));
    byCategory.set(category, { category, ratio, observations: obs, used: obs >= model.ratio_min_obs ? 'category' : 'market' });
  }
  return { byCategory, market: Math.min(model.ratio_cap, Math.max(model.ratio_floor, market)) };
}

/** The ratio one protocol's category carries, with its source. */
export function ratioFor(p: SnapshotProtocol, ratios: Map<string, CategoryRatio>, market: number): { ratio: number; source: 'category' | 'market'; obs: number } {
  const entry = ratios.get(p.category ?? 'Other');
  if (entry !== undefined) return { ratio: entry.ratio, source: entry.used, obs: entry.observations };
  return { ratio: market, source: 'market', obs: 0 };
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  ratios: Map<string, CategoryRatio>,
  market: number,
  model: ModelConstants = MODEL,
): { implied: number; ratio: number; ratioSource: 'category' | 'market'; ratioObs: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { ratio, source, obs } = ratioFor(protocol, ratios, market);
  // The ratio is rounded to 4 decimals before it is used, so the page's recompute
  // (which reads the rounded ratio out of the row) lands on the same integer.
  const ratio4 = Math.round(ratio * 1e4) / 1e4;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * Math.sqrt(Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days);
  const breadthMult = 1 + model.breadth_per_chain * Math.min(protocol.chains.length, model.breadth_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * ratio4 * growthMult * maturityMult * breadthMult));
  return { implied, ratio: ratio4, ratioSource: source, ratioObs: obs, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a product of a token that already trades, not a new launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names of exchanges, whose own token already trades even when the record omits it. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a pre-token protocol is not one the board may rank, or null when it is rankable. */
export function screenReason(p: SnapshotProtocol): string | null {
  if (!isPreToken(p)) return 'token already trades';
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) {
    return p.category === 'CEX' ? 'exchange: its own token already trades' : `a ${p.category.toLowerCase()} product of a token that already trades`;
  }
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  const words = p.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return 'wrapped or staked product of a token that already trades';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange product: its own token already trades';
  return null;
}

/** Whether a protocol is one the board may rank. */
export function isRankable(p: SnapshotProtocol): boolean {
  return screenReason(p) === null;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { byCategory, market } = categoryRatios(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable protocol below the watchlist floor, not just the
  // biggest few. A chosen protocol stays chosen.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, byCategory, market, model);
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
    model: {
      category_ratio: round4(s.ratio),
      ratio_source: s.ratioSource,
      ratio_obs: s.ratioObs,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

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

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain: L1s charge dollars, L2s cents, Solana fractions. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum' || c === 'bitcoin') return 'about $5 to $15 of gas';
  if (c === 'solana') return 'under $0.10 of fees';
  if (['arbitrum', 'base', 'optimism', 'polygon', 'zksync', 'blast', 'mode', 'scroll', 'linea', 'mantle', 'berachain', 'monad', 'hyperliquid l1', 'avalanche', 'bnb', 'binance'].some((l2) => c.includes(l2))) return 'under $1 of gas';
  return 'a few dollars of gas';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC as collateral on ${name} on ${chain} and borrow a small amount against it.`;
  if (c.includes('cdp')) return `Lock $${capital} of collateral in a ${name} vault on ${chain} and mint its stable asset.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and let it compound.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis vault on ${chain} and hold it through one funding cycle.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} curator vault on ${chain} and keep the vault shares.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and take one position on a ${name} market on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it through one distribution.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s own chain and use its native app once a week.`;
  if (c.includes('liquidity manager')) return `Deposit $${capital} into a ${name} managed liquidity position on ${chain}.`;
  if (c.includes('leveraged farm')) return `Open a $${capital} leveraged farming position on ${name} on ${chain} at low leverage.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's one thing to check before putting money in. */
function watchFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp')) return `Check ${name}'s liquidation line first and keep the collateral ratio above it, so a sharp price move cannot liquidate the position.`;
  if (c.includes('dex')) return `Check the pool's impermanent loss first: a volatile pair can lose value against simply holding the assets.`;
  if (c.includes('yield')) return `Check where ${name}'s yield really comes from: a headline APY can be incentives that end.`;
  if (c.includes('basis')) return `Check the funding rate before entering: a negative rate turns the trade against you.`;
  if (c.includes('curator') || c.includes('allocator')) return `Check the vault's curator, fee and track record first: the manager decides the return.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Use low leverage and check the funding rate: a spike can eat the margin.`;
  if (c.includes('prediction')) return `Only stake what you can lose: a market can resolve against you.`;
  if (c.includes('rwa')) return `Check what backs the asset and who the custodian is before minting.`;
  if (c.includes('restak') || c.includes('staking pool')) return `Check the operator's slashing history first: a misbehaving operator can lose staked funds.`;
  if (c.includes('leveraged farm')) return `Keep leverage low and watch the borrow rate: it can rise faster than the farm yield.`;
  return `Read ${name}'s own docs first and confirm the app address from its official channel, never from a DM or an ad.`;
}

/** The weekly qualifying action, worded for the category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp')) return 'Make one qualifying action each week, such as a deposit, a borrow or a repayment.';
  if (c.includes('dex')) return 'Make one qualifying action each week, such as a swap or a liquidity adjustment.';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Make one qualifying action each week, such as a trade or a margin adjustment.';
  if (c.includes('prediction')) return 'Make one qualifying action each week, such as a new market position or a settlement claim.';
  if (c.includes('curator') || c.includes('allocator')) return 'Make one qualifying action each week, such as a deposit, a rebalance or a vote.';
  return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
}

/**
 * A protocol's farm plan: seven or eight steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL, age), never
 * from a hand-written list of names: the capital tier follows its TVL, the gas follows
 * its chain, the hold follows its age, and a protocol on two or more chains gets a
 * step to mirror the position on its second chain.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const steps: FarmStep[] = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `${gas} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and ${gas}`,
      time: '15 minutes to set up',
    },
    {
      text: watchFor(p),
      cost: 'nothing to check',
      time: '10 minutes',
    },
  ];
  if (p.chains.length >= 2) {
    steps.push({
      text: `Mirror the same position on ${p.chains[1]} so activity is recorded on both chains.`,
      cost: `$${capital} more of capital and ${gasFor(p.chains[1]!)}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: weeklyFor(p),
      cost: `${gas} a week`,
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
      text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps;
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

/** The pre-token protocols the screen left out, with the reason each was left out. */
export function excludedRows(snapshot: Snapshot): ExcludedRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && screenReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: screenReason(p)!,
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
    category_ratio: row.model.category_ratio,
    ratio_source: row.model.ratio_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const excluded = excludedRows(snapshot);
  const { byCategory, market } = categoryRatios(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categoryRatiosList: CategoryRatio[] = [...byCategory.values()]
    .filter((r) => r.used === 'category')
    .sort((a, b) => b.ratio - a.ratio);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    market_ratio: round4(market),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    excluded_size: excluded.length,
    category_ratios: categoryRatiosList,
    watchlist: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
    excluded,
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
