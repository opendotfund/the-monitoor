// Mock live data for The Monitor. In production these come from provider APIs.
// See MonitorPage for the list of required upstream APIs.

export type Book =
  | "TXOdds"
  | "Polymarket"
  | "Kalshi"
  | "PredictIt"
  | "Betfair"
  | "Pinnacle"
  | "Smarkets";

export interface MarketQuote {
  book: Book;
  prob: number; // implied probability 0..1
  delta1m: number; // change in last minute (pp)
  liquidity: number; // notional depth USD
  lastUpdate: number; // ms since update
}

export interface MarketRow {
  id: string;
  event: string;
  outcome: string;
  category: "Sports" | "Politics" | "Crypto" | "Culture";
  quotes: MarketQuote[];
}

const now = () => Math.floor(Math.random() * 8000);

export const seedMarkets: MarketRow[] = [
  {
    id: "wc-final-arg",
    event: "World Cup Final — Winner",
    outcome: "Argentina",
    category: "Sports",
    quotes: [
      { book: "TXOdds", prob: 0.612, delta1m: +0.4, liquidity: 480_000, lastUpdate: now() },
      { book: "Pinnacle", prob: 0.641, delta1m: +1.8, liquidity: 1_200_000, lastUpdate: now() },
      { book: "Betfair", prob: 0.638, delta1m: +1.5, liquidity: 890_000, lastUpdate: now() },
      { book: "Polymarket", prob: 0.635, delta1m: +2.1, liquidity: 320_000, lastUpdate: now() },
      { book: "Smarkets", prob: 0.629, delta1m: +1.2, liquidity: 210_000, lastUpdate: now() },
    ],
  },
  {
    id: "wc-sf-bra-fra",
    event: "Brazil vs France — Match Winner",
    outcome: "Brazil",
    category: "Sports",
    quotes: [
      { book: "TXOdds", prob: 0.548, delta1m: -0.1, liquidity: 260_000, lastUpdate: now() },
      { book: "Pinnacle", prob: 0.551, delta1m: -0.2, liquidity: 940_000, lastUpdate: now() },
      { book: "Betfair", prob: 0.546, delta1m: -0.3, liquidity: 610_000, lastUpdate: now() },
      { book: "Polymarket", prob: 0.552, delta1m: 0.0, liquidity: 180_000, lastUpdate: now() },
    ],
  },
  {
    id: "wc-top-scorer-mbappe",
    event: "World Cup Top Scorer",
    outcome: "Mbappé",
    category: "Sports",
    quotes: [
      { book: "TXOdds", prob: 0.212, delta1m: +0.2, liquidity: 140_000, lastUpdate: now() },
      { book: "Pinnacle", prob: 0.244, delta1m: +2.9, liquidity: 380_000, lastUpdate: now() },
      { book: "Betfair", prob: 0.238, delta1m: +2.4, liquidity: 260_000, lastUpdate: now() },
      { book: "Polymarket", prob: 0.241, delta1m: +2.7, liquidity: 90_000, lastUpdate: now() },
      { book: "Smarkets", prob: 0.235, delta1m: +2.0, liquidity: 70_000, lastUpdate: now() },
    ],
  },
  {
    id: "wc-group-ger-adv",
    event: "Germany Advances Group Stage",
    outcome: "Yes",
    category: "Sports",
    quotes: [
      { book: "TXOdds", prob: 0.702, delta1m: 0.0, liquidity: 190_000, lastUpdate: now() },
      { book: "Pinnacle", prob: 0.706, delta1m: +0.1, liquidity: 420_000, lastUpdate: now() },
      { book: "Betfair", prob: 0.704, delta1m: -0.1, liquidity: 300_000, lastUpdate: now() },
      { book: "Polymarket", prob: 0.709, delta1m: +0.2, liquidity: 110_000, lastUpdate: now() },
    ],
  },
  {
    id: "us-elec-2028",
    event: "2028 US Presidential — Party",
    outcome: "Democratic",
    category: "Politics",
    quotes: [
      { book: "TXOdds", prob: 0.484, delta1m: +0.1, liquidity: 90_000, lastUpdate: now() },
      { book: "Polymarket", prob: 0.512, delta1m: +1.6, liquidity: 2_400_000, lastUpdate: now() },
      { book: "Kalshi", prob: 0.508, delta1m: +1.3, liquidity: 1_100_000, lastUpdate: now() },
      { book: "PredictIt", prob: 0.505, delta1m: +1.1, liquidity: 210_000, lastUpdate: now() },
      { book: "Betfair", prob: 0.501, delta1m: +0.9, liquidity: 640_000, lastUpdate: now() },
    ],
  },
];

// Deterministic-ish jitter, keeps UI feeling live.
export function tick(rows: MarketRow[]): MarketRow[] {
  return rows.map((row) => ({
    ...row,
    quotes: row.quotes.map((q) => {
      const drift = (Math.random() - 0.5) * 0.006;
      const nextProb = Math.max(0.01, Math.min(0.99, q.prob + drift));
      const delta = (nextProb - q.prob) * 100 + q.delta1m * 0.85;
      return {
        ...q,
        prob: nextProb,
        delta1m: +delta.toFixed(2),
        lastUpdate: Math.random() < 0.4 ? 0 : q.lastUpdate + 1500,
      };
    }),
  }));
}

export interface Discrepancy {
  row: MarketRow;
  tx: MarketQuote;
  consensus: number; // avg of non-TX books
  spreadPP: number; // percentage points
  direction: "TX_LOW" | "TX_HIGH";
  severity: "info" | "warn" | "critical";
}

export function analyze(rows: MarketRow[]): Discrepancy[] {
  const out: Discrepancy[] = [];
  for (const row of rows) {
    const tx = row.quotes.find((q) => q.book === "TXOdds");
    if (!tx) continue;
    const others = row.quotes.filter((q) => q.book !== "TXOdds");
    if (!others.length) continue;
    const consensus =
      others.reduce((s, q) => s + q.prob * q.liquidity, 0) /
      others.reduce((s, q) => s + q.liquidity, 0);
    const spreadPP = (consensus - tx.prob) * 100;
    const abs = Math.abs(spreadPP);
    if (abs < 0.6) continue;
    const severity: Discrepancy["severity"] =
      abs > 2.5 ? "critical" : abs > 1.2 ? "warn" : "info";
    out.push({
      row,
      tx,
      consensus,
      spreadPP,
      direction: spreadPP > 0 ? "TX_LOW" : "TX_HIGH",
      severity,
    });
  }
  return out.sort((a, b) => Math.abs(b.spreadPP) - Math.abs(a.spreadPP));
}

export interface SharpMove {
  id: string;
  ts: number;
  row: MarketRow;
  book: Book;
  deltaPP: number;
}

export function detectSharpMoves(rows: MarketRow[]): SharpMove[] {
  const moves: SharpMove[] = [];
  for (const row of rows) {
    for (const q of row.quotes) {
      if (Math.abs(q.delta1m) >= 1.5) {
        moves.push({
          id: `${row.id}-${q.book}-${Date.now()}`,
          ts: Date.now(),
          row,
          book: q.book,
          deltaPP: q.delta1m,
        });
      }
    }
  }
  return moves;
}

export function formatPct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatMoney(x: number) {
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(0)}k`;
  return `$${x}`;
}

// Convert probability to fair decimal odds
export function toOdds(p: number) {
  return (1 / p).toFixed(3);
}

// Simple 2-book arbitrage on a single YES/NO binary (buy YES cheapest, NO cheapest)
// Here we approximate with: if TX prob and any other book prob differ enough,
// a same-side positional trade nets edge = |consensus - tx| minus assumed fees.
export function edgeAfterFees(spreadPP: number, feesPP = 0.5) {
  return Math.max(0, Math.abs(spreadPP) - feesPP);
}
