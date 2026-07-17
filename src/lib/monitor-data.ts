// Analysis helpers for The Monitor. Data comes from getMonitorSnapshot
// (Polymarket + Kalshi live; TX Odds is a simulated quote drifted from
// consensus until the real TX feed is wired).

import type { Book, MarketQuote, MarketRow } from "./monitor-sources.functions";

export type { Book, MarketQuote, MarketRow };

export interface Discrepancy {
  row: MarketRow;
  tx: MarketQuote;
  consensus: number;
  spreadPP: number; // percentage points, consensus - tx
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
    const totalLiq = others.reduce((s, q) => s + Math.max(q.liquidity, 1), 0);
    const consensus =
      others.reduce((s, q) => s + q.prob * Math.max(q.liquidity, 1), 0) / totalLiq;
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

// Diff two snapshots to produce sharp moves ≥ threshold pp.
export function diffSharpMoves(
  prev: Map<string, Map<Book, number>>,
  next: MarketRow[],
  thresholdPP = 1.5,
): SharpMove[] {
  const moves: SharpMove[] = [];
  const ts = Date.now();
  for (const row of next) {
    const prevBooks = prev.get(row.id);
    if (!prevBooks) continue;
    for (const q of row.quotes) {
      const prior = prevBooks.get(q.book);
      if (prior == null) continue;
      const deltaPP = (q.prob - prior) * 100;
      if (Math.abs(deltaPP) >= thresholdPP) {
        moves.push({ id: `${row.id}-${q.book}-${ts}`, ts, row, book: q.book, deltaPP });
      }
    }
  }
  return moves;
}

export function snapshotMap(rows: MarketRow[]): Map<string, Map<Book, number>> {
  const m = new Map<string, Map<Book, number>>();
  for (const row of rows) {
    const bm = new Map<Book, number>();
    for (const q of row.quotes) bm.set(q.book, q.prob);
    m.set(row.id, bm);
  }
  return m;
}

export function formatPct(x: number, digits = 1) {
  return `${(x * 100).toFixed(digits)}%`;
}

export function formatMoney(x: number) {
  if (x >= 1_000_000) return `$${(x / 1_000_000).toFixed(1)}M`;
  if (x >= 1_000) return `$${(x / 1_000).toFixed(0)}k`;
  return `$${Math.round(x)}`;
}

export function toOdds(p: number) {
  return (1 / p).toFixed(3);
}

export function edgeAfterFees(spreadPP: number, feesPP = 0.5) {
  return Math.max(0, Math.abs(spreadPP) - feesPP);
}

export interface InsiderSuspect {
  row: MarketRow;
  trigger: "WHALE ON LONGSHOT" | "MASSIVE DIVERGENCE";
  severity: "critical" | "warn";
  details: string;
}

export function analyzeInsiderTrades(rows: MarketRow[]): InsiderSuspect[] {
  const suspects: InsiderSuspect[] = [];

  for (const row of rows) {
    const others = row.quotes.filter((q) => q.book !== "TXOdds");
    if (!others.length) continue;

    // Check for "Whale on Longshot" across any real book
    for (const q of others) {
      if ((q.prob < 0.15 || q.prob > 0.85) && q.liquidity > 100_000) {
        suspects.push({
          row,
          trigger: "WHALE ON LONGSHOT",
          severity: q.liquidity > 500_000 ? "critical" : "warn",
          details: `${q.book}: ${formatPct(q.prob, 1)} with ${formatMoney(q.liquidity)} liq`,
        });
        break; // don't double count for this row
      }
    }

    // Check for Massive Divergence between real books
    if (others.length >= 2) {
      let min = others[0].prob;
      let max = others[0].prob;
      let maxLiq = others[0].liquidity;
      for (const q of others) {
        if (q.prob < min) min = q.prob;
        if (q.prob > max) max = q.prob;
        if (q.liquidity > maxLiq) maxLiq = q.liquidity;
      }
      const spread = (max - min) * 100;
      if (spread > 5 && maxLiq > 50_000) {
        suspects.push({
          row,
          trigger: "MASSIVE DIVERGENCE",
          severity: spread > 10 ? "critical" : "warn",
          details: `${spread.toFixed(1)}pp gap across books`,
        });
      }
    }
  }

  // Deduplicate and sort by severity (critical first)
  const unique = Array.from(new Map(suspects.map((s) => [s.row.id + s.trigger, s])).values());
  return unique.sort((a, b) => (a.severity === "critical" ? -1 : b.severity === "critical" ? 1 : 0));
}
