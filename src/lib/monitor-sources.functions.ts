import { createServerFn } from "@tanstack/react-start";

export type Book = "TXOdds" | "Polymarket" | "Kalshi";

export interface MarketQuote {
  book: Book;
  prob: number;
  liquidity: number;
  simulated?: boolean;
}

export interface MarketRow {
  id: string;
  event: string;
  outcome: string;
  category: "Sports" | "Politics" | "Crypto" | "Culture" | "Economics" | "Other";
  quotes: MarketQuote[];
}

export interface MonitorSnapshot {
  ts: number;
  rows: MarketRow[];
  errors: { source: string; message: string }[];
}

// --- normalization helpers ---
const STOP = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "at", "vs",
  "will", "be", "by", "with", "is", "are", "this", "that", "over", "under",
  "than", "as", "if", "market", "election", "presidential", "next", "us",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

function categorize(text: string): MarketRow["category"] {
  const t = text.toLowerCase();
  if (/(nba|nfl|nhl|mlb|soccer|football|tennis|ufc|boxing|golf|cricket|world cup|super bowl|championship|match|game)/.test(t))
    return "Sports";
  if (/(election|president|senate|congress|governor|primary|vote|poll|nominee|trump|biden|harris)/.test(t))
    return "Politics";
  if (/(bitcoin|btc|ethereum|eth|crypto|solana|token|coin)/.test(t)) return "Crypto";
  if (/(fed|inflation|gdp|rate|cpi|jobs|unemployment|recession)/.test(t)) return "Economics";
  if (/(oscar|grammy|movie|album|song|celebrity|show|tv|film)/.test(t)) return "Culture";
  return "Other";
}

// deterministic pseudo-random from string
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

// --- Polymarket ---
interface PolyMarket {
  id: string;
  slug: string;
  question: string;
  outcomes: string; // JSON string
  outcomePrices: string; // JSON string
  volume?: string | number;
  liquidity?: string | number;
  active: boolean;
  closed: boolean;
}

async function fetchPolymarket(): Promise<{ rows: MarketRow[]; error?: string }> {
  try {
    const url =
      "https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=80&order=volume&ascending=false";
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { rows: [], error: `Polymarket ${res.status}` };
    const data = (await res.json()) as PolyMarket[];
    const rows: MarketRow[] = [];
    for (const m of data) {
      if (!m.question || !m.outcomes || !m.outcomePrices) continue;
      let outcomes: string[];
      let prices: string[];
      try {
        outcomes = JSON.parse(m.outcomes);
        prices = JSON.parse(m.outcomePrices);
      } catch {
        continue;
      }
      const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
      const idx = yesIdx >= 0 ? yesIdx : 0;
      const prob = Number(prices[idx]);
      if (!isFinite(prob) || prob <= 0 || prob >= 1) continue;
      const liquidity = Number(m.liquidity ?? m.volume ?? 0);
      rows.push({
        id: `poly-${m.id}`,
        event: m.question,
        outcome: outcomes[idx] ?? "Yes",
        category: categorize(m.question),
        quotes: [{ book: "Polymarket", prob, liquidity }],
      });
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: `Polymarket: ${(e as Error).message}` };
  }
}

// --- Kalshi ---
interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  yes_bid: number;
  yes_ask: number;
  last_price: number;
  status: string;
  open_interest?: number;
  volume?: number;
}

async function fetchKalshi(): Promise<{ rows: MarketRow[]; error?: string }> {
  try {
    const url =
      "https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=200";
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { rows: [], error: `Kalshi ${res.status}` };
    const data = (await res.json()) as { markets: KalshiMarket[] };
    const rows: MarketRow[] = [];
    for (const m of data.markets ?? []) {
      const mid = (m.yes_bid + m.yes_ask) / 2;
      if (!isFinite(mid) || mid <= 0 || mid >= 100) continue;
      const prob = mid / 100;
      const title = m.title + (m.subtitle ? ` — ${m.subtitle}` : "");
      rows.push({
        id: `kalshi-${m.ticker}`,
        event: title,
        outcome: "Yes",
        category: categorize(title),
        quotes: [
          {
            book: "Kalshi",
            prob,
            liquidity: (m.open_interest ?? m.volume ?? 0) * 1, // cents ~ USD proxy
          },
        ],
      });
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: `Kalshi: ${(e as Error).message}` };
  }
}

// --- merge: match Poly ↔ Kalshi by token overlap ---
function mergeSources(poly: MarketRow[], kalshi: MarketRow[]): MarketRow[] {
  const kTokens = kalshi.map((k) => ({ row: k, toks: tokens(k.event) }));
  const usedKalshi = new Set<number>();
  const merged: MarketRow[] = [];

  for (const p of poly) {
    const pt = tokens(p.event);
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < kTokens.length; i++) {
      if (usedKalshi.has(i)) continue;
      const s = overlap(pt, kTokens[i].toks);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 3) {
      usedKalshi.add(best);
      const k = kTokens[best].row;
      merged.push({
        id: p.id,
        event: p.event,
        outcome: p.outcome,
        category: p.category,
        quotes: [...p.quotes, ...k.quotes],
      });
    } else {
      merged.push(p);
    }
  }

  // append unmatched kalshi rows (top by liquidity)
  for (let i = 0; i < kTokens.length; i++) {
    if (usedKalshi.has(i)) continue;
    merged.push(kTokens[i].row);
  }

  return merged;
}

// Add a simulated TXOdds quote drifted deterministically from consensus.
// Drift changes with a ~30s time bucket so the UI shows moves & discrepancies.
function withSimulatedTX(rows: MarketRow[]): MarketRow[] {
  const bucket = Math.floor(Date.now() / 30_000);
  return rows.map((r) => {
    const real = r.quotes;
    const totalLiq = real.reduce((s, q) => s + Math.max(q.liquidity, 1), 0);
    const consensus =
      real.reduce((s, q) => s + q.prob * Math.max(q.liquidity, 1), 0) / totalLiq;
    const seed = hash(r.id + ":" + bucket);
    // ±3pp drift, occasionally larger
    const magnitude = seed < 0.15 ? 0.04 : 0.02;
    const offset = (hash(r.id + ":" + (bucket + 1)) - 0.5) * 2 * magnitude;
    const txProb = Math.max(0.01, Math.min(0.99, consensus + offset));
    return {
      ...r,
      quotes: [
        {
          book: "TXOdds" as const,
          prob: txProb,
          liquidity: Math.round(50_000 + seed * 500_000),
          simulated: true,
        },
        ...real,
      ],
    };
  });
}

export const getMonitorSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<MonitorSnapshot> => {
    const [poly, kalshi] = await Promise.all([fetchPolymarket(), fetchKalshi()]);
    const errors: { source: string; message: string }[] = [];
    if (poly.error) errors.push({ source: "Polymarket", message: poly.error });
    if (kalshi.error) errors.push({ source: "Kalshi", message: kalshi.error });

    let merged = mergeSources(poly.rows, kalshi.rows);
    // prefer rows with >1 real book, then higher liquidity; cap to keep UI snappy
    merged.sort((a, b) => {
      const ax = a.quotes.length;
      const bx = b.quotes.length;
      if (ax !== bx) return bx - ax;
      const al = a.quotes.reduce((s, q) => s + q.liquidity, 0);
      const bl = b.quotes.reduce((s, q) => s + q.liquidity, 0);
      return bl - al;
    });
    merged = merged.slice(0, 40);
    const rows = withSimulatedTX(merged);
    return { ts: Date.now(), rows, errors };
  },
);
