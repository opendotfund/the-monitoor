import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyze,
  diffSharpMoves,
  snapshotMap,
  formatPct,
  formatMoney,
  toOdds,
  edgeAfterFees,
  type MarketRow,
  type Book,
  type SharpMove,
} from "@/lib/monitor-data";
import {
  getMonitorSnapshot,
  type MonitorSnapshot,
} from "@/lib/monitor-sources.functions";

const monitorQuery = queryOptions<MonitorSnapshot>({
  queryKey: ["monitor-snapshot"],
  queryFn: () => getMonitorSnapshot(),
  staleTime: 0,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Monitor — TX Odds Surveillance Console" },
      {
        name: "description",
        content:
          "Real-time surveillance console comparing TX Odds against Polymarket and Kalshi. Flags sharp movements, arbitrage windows and mispriced markets.",
      },
      { property: "og:title", content: "The Monitor — TX Odds Surveillance" },
      {
        property: "og:description",
        content:
          "Cross-book prediction market surveillance. Sharp move detection, arb finder, and admin market-reset alerts.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(monitorQuery),
  component: MonitorPage,
  errorComponent: ({ error }) => (
    <div className="min-h-screen bg-[#07090c] text-[#d7e0ea] font-mono p-6">
      <div className="text-[#ff5a6b] text-[11px] tracking-widest">FEED ERROR</div>
      <pre className="text-[11px] mt-2 whitespace-pre-wrap">{error.message}</pre>
    </div>
  ),
  notFoundComponent: () => (
    <div className="min-h-screen bg-[#07090c] text-[#d7e0ea] font-mono p-6 text-[11px]">
      market not found
    </div>
  ),
});

type Tab = "arb" | "admin";

function MonitorPage() {
  const [tab, setTab] = useState<Tab>("arb");
  const [paused, setPaused] = useState(false);
  const [feed, setFeed] = useState<SharpMove[]>([]);

  const { data } = useSuspenseQuery({
    ...monitorQuery,
    refetchInterval: paused ? false : 5000,
    refetchIntervalInBackground: true,
  });
  const rows = data.rows;

  // Sharp-move detection: diff each new snapshot against the previous one.
  const prevSnapRef = useRef<Map<string, Map<Book, number>> | null>(null);
  useEffect(() => {
    if (prevSnapRef.current) {
      const moves = diffSharpMoves(prevSnapRef.current, rows);
      if (moves.length) {
        setFeed((f) => [...moves, ...f].slice(0, 80));
      }
    }
    prevSnapRef.current = snapshotMap(rows);
  }, [rows]);

  const discrepancies = useMemo(() => analyze(rows), [rows]);
  const critical = discrepancies.filter((d) => d.severity === "critical").length;
  const warn = discrepancies.filter((d) => d.severity === "warn").length;

  return (
    <div className="min-h-screen bg-[#07090c] text-[#d7e0ea] font-mono">
      <TopBar
        critical={critical}
        warn={warn}
        paused={paused}
        setPaused={setPaused}
        rowCount={rows.length}
        errors={data.errors}
      />

      <div className="border-b border-[#1a2129] bg-[#0b0f14]">
        <div className="mx-auto max-w-[1400px] px-4 flex gap-1">
          <TabButton active={tab === "arb"} onClick={() => setTab("arb")}>
            ARB BETTOR
          </TabButton>
          <TabButton active={tab === "admin"} onClick={() => setTab("admin")}>
            TX ODDS ADMIN
          </TabButton>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-4 py-4 grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-8">
          {tab === "arb" ? <ArbView rows={rows} /> : <AdminView rows={rows} />}
        </section>

        <aside className="col-span-12 lg:col-span-4 space-y-4">
          <SharpTape feed={feed} />
          <BookHealth rows={rows} />
        </aside>
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-2 text-[10px] text-[#4a5766] flex flex-wrap gap-4">
        <span>THE MONITOR v0.2</span>
        <span>·</span>
        <span>polymarket gamma-api · kalshi trade-api v2</span>
        <span>·</span>
        <span className="text-[#f0b429]">
          TX feed simulated (drift from consensus) — awaiting txodds.com credentials
        </span>
        <span>·</span>
        <Link to="/" className="underline hover:text-[#8ea3b8]">
          reload
        </Link>
      </footer>
    </div>
  );
}

function TopBar({
  critical,
  warn,
  paused,
  setPaused,
  rowCount,
  errors,
}: {
  critical: number;
  warn: number;
  paused: boolean;
  setPaused: (v: boolean) => void;
  rowCount: number;
  errors: { source: string; message: string }[];
}) {
  return (
    <header className="border-b border-[#1a2129] bg-[#0b0f14]">
      <div className="mx-auto max-w-[1400px] px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-[#3ee08a] animate-pulse" />
          <h1 className="text-[13px] tracking-[0.28em] font-semibold text-[#e6edf5]">
            THE&nbsp;MONITOR
          </h1>
          <span className="text-[10px] text-[#4a5766]">// TX ODDS SURVEILLANCE</span>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] flex-wrap">
          <Stat label="MKTS" value={rowCount} tone="muted" />
          <Stat label="CRIT" value={critical} tone={critical ? "crit" : "muted"} />
          <Stat label="WARN" value={warn} tone={warn ? "warn" : "muted"} />
          <Stat
            label="FEED"
            value={paused ? "PAUSED" : "LIVE"}
            tone={paused ? "muted" : "ok"}
          />
          {errors.map((e) => (
            <Stat key={e.source} label={e.source.toUpperCase()} value="DOWN" tone="crit" />
          ))}
          <button
            onClick={() => setPaused(!paused)}
            className="border border-[#1f2932] hover:border-[#3ee08a] px-2 py-1 text-[10px] tracking-widest"
          >
            {paused ? "RESUME" : "PAUSE"}
          </button>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "ok" | "warn" | "crit" | "muted";
}) {
  const color =
    tone === "crit"
      ? "text-[#ff5a6b]"
      : tone === "warn"
        ? "text-[#f0b429]"
        : tone === "ok"
          ? "text-[#3ee08a]"
          : "text-[#4a5766]";
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[#4a5766] tracking-widest">{label}</span>
      <span className={`${color} font-semibold`}>{value}</span>
    </span>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-[11px] tracking-[0.22em] border-b-2 -mb-px transition-colors ${
        active
          ? "border-[#3ee08a] text-[#e6edf5]"
          : "border-transparent text-[#4a5766] hover:text-[#8ea3b8]"
      }`}
    >
      {children}
    </button>
  );
}

/* -------------------------------- ARB TAB -------------------------------- */

function ArbView({ rows }: { rows: MarketRow[] }) {
  const disc = useMemo(() => analyze(rows), [rows]);
  const opps = disc.filter((d) => edgeAfterFees(d.spreadPP) > 0);

  return (
    <Panel
      title="ARBITRAGE OPPORTUNITIES"
      subtitle="TX price vs weighted consensus of Polymarket + Kalshi. Buy side = market that hasn't adjusted."
      right={<span className="text-[#3ee08a] text-[11px]">{opps.length} live</span>}
    >
      <div className="divide-y divide-[#141a21]">
        <RowHeader
          cols={["MARKET", "TX", "CONSENSUS", "EDGE", "BUY", "SIZE HINT", "ACTION"]}
        />
        {opps.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-[#4a5766]">
            no arb over fee threshold — scanning…
          </div>
        )}
        {opps.map((d) => {
          const edge = edgeAfterFees(d.spreadPP);
          const buySide = d.direction === "TX_LOW" ? "TX" : "OTHERS";
          const size = Math.min(
            25_000,
            Math.round(edge * 4000 + d.tx.liquidity * 0.02),
          );
          return (
            <div
              key={d.row.id}
              className="grid grid-cols-[2.4fr_0.7fr_0.9fr_0.7fr_0.7fr_0.9fr_0.9fr] gap-2 px-3 py-2.5 text-[12px] hover:bg-[#0d1218]"
            >
              <div>
                <div className="text-[#e6edf5] line-clamp-1">{d.row.event}</div>
                <div className="text-[10px] text-[#4a5766]">
                  {d.row.outcome} · {d.row.category} ·{" "}
                  {d.row.quotes
                    .filter((q) => q.book !== "TXOdds")
                    .map((q) => q.book)
                    .join("+")}
                </div>
              </div>
              <div className="tabular-nums">{formatPct(d.tx.prob, 2)}</div>
              <div className="tabular-nums">{formatPct(d.consensus, 2)}</div>
              <div
                className={`tabular-nums font-semibold ${
                  d.severity === "critical"
                    ? "text-[#ff5a6b]"
                    : d.severity === "warn"
                      ? "text-[#f0b429]"
                      : "text-[#3ee08a]"
                }`}
              >
                +{edge.toFixed(2)}pp
              </div>
              <div className="text-[#8ea3b8]">{buySide}</div>
              <div className="tabular-nums text-[#8ea3b8]">{formatMoney(size)}</div>
              <div>
                <button className="border border-[#1f2932] hover:border-[#3ee08a] hover:text-[#3ee08a] px-2 py-1 text-[10px] tracking-widest">
                  STAGE ORDER
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-[#141a21] px-3 py-2 text-[10px] text-[#4a5766] flex justify-between">
        <span>edge = |consensus − TX| − 0.5pp fee assumption</span>
        <span>refreshed every 5s</span>
      </div>
    </Panel>
  );
}

/* ------------------------------- ADMIN TAB ------------------------------- */

function AdminView({ rows }: { rows: MarketRow[] }) {
  const disc = useMemo(() => analyze(rows), [rows]);

  return (
    <Panel
      title="TX ODDS — MARKET INTEGRITY"
      subtitle="Where TX prices diverge from the multi-book consensus. Reset the market to the suggested probability."
      right={
        <span className="text-[#f0b429] text-[11px]">
          {disc.filter((d) => d.severity !== "info").length} require review
        </span>
      }
    >
      <div className="divide-y divide-[#141a21]">
        <RowHeader
          cols={[
            "MARKET",
            "TX PRICE",
            "TX ODDS",
            "CONSENSUS",
            "DRIFT",
            "SUGGESTED RESET",
            "ACTION",
          ]}
        />
        {disc.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-[#4a5766]">
            all TX markets in line with consensus.
          </div>
        )}
        {disc.map((d) => {
          const badge =
            d.severity === "critical"
              ? { txt: "CRITICAL", cls: "text-[#ff5a6b] border-[#ff5a6b]/40" }
              : d.severity === "warn"
                ? { txt: "WARN", cls: "text-[#f0b429] border-[#f0b429]/40" }
                : { txt: "INFO", cls: "text-[#3ee08a] border-[#3ee08a]/40" };
          return (
            <div
              key={d.row.id}
              className="grid grid-cols-[2.2fr_0.8fr_0.8fr_0.9fr_0.9fr_1fr_0.9fr] gap-2 px-3 py-2.5 text-[12px] hover:bg-[#0d1218]"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] tracking-widest px-1.5 py-0.5 border ${badge.cls}`}
                  >
                    {badge.txt}
                  </span>
                  <span className="text-[#e6edf5] line-clamp-1">{d.row.event}</span>
                </div>
                <div className="text-[10px] text-[#4a5766] mt-0.5">
                  {d.row.outcome} · id:{d.row.id}
                </div>
              </div>
              <div className="tabular-nums">{formatPct(d.tx.prob, 2)}</div>
              <div className="tabular-nums text-[#8ea3b8]">{toOdds(d.tx.prob)}</div>
              <div className="tabular-nums">{formatPct(d.consensus, 2)}</div>
              <div
                className={`tabular-nums ${
                  d.direction === "TX_LOW" ? "text-[#ff5a6b]" : "text-[#f0b429]"
                }`}
              >
                {d.spreadPP > 0 ? "+" : ""}
                {d.spreadPP.toFixed(2)}pp
              </div>
              <div className="tabular-nums text-[#3ee08a]">
                {formatPct(d.consensus, 2)} @ {toOdds(d.consensus)}
              </div>
              <div>
                <button className="border border-[#1f2932] hover:border-[#f0b429] hover:text-[#f0b429] px-2 py-1 text-[10px] tracking-widest">
                  RESET MARKET
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ------------------------------- SIDE PANELS ------------------------------ */

function SharpTape({ feed }: { feed: SharpMove[] }) {
  return (
    <Panel title="SHARP TAPE" subtitle="≥1.5pp moves per refresh (5s)">
      <div className="max-h-[320px] overflow-auto text-[11px] leading-relaxed">
        {feed.length === 0 && (
          <div className="px-3 py-6 text-center text-[#4a5766]">no sharp moves yet…</div>
        )}
        {feed.map((m) => (
          <div
            key={m.id}
            className="px-3 py-1 border-b border-[#0f141a] text-[#8ea3b8]"
          >
            <span className="text-[#4a5766]">
              {new Date(m.ts).toLocaleTimeString()}{" "}
            </span>
            <span className="text-[#e6edf5]">{m.book.padEnd(11)}</span>{" "}
            <span
              className={m.deltaPP > 0 ? "text-[#3ee08a]" : "text-[#ff5a6b]"}
            >
              {m.deltaPP > 0 ? "▲" : "▼"} {Math.abs(m.deltaPP).toFixed(2)}pp
            </span>{" "}
            <span className="text-[#8ea3b8] line-clamp-1 inline">
              {m.row.event}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function BookHealth({ rows }: { rows: MarketRow[] }) {
  const books: Book[] = ["TXOdds", "Polymarket", "Kalshi"];
  const stats = books.map((b) => {
    const qs = rows.flatMap((r) => r.quotes.filter((q) => q.book === b));
    const simulated = qs.some((q) => q.simulated);
    return { book: b, count: qs.length, simulated };
  });
  return (
    <Panel title="BOOK HEALTH" subtitle="coverage across sources">
      <div className="divide-y divide-[#141a21]">
        {stats.map((s) => (
          <div
            key={s.book}
            className="flex items-center justify-between px-3 py-2 text-[11px]"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  s.count === 0
                    ? "bg-[#ff5a6b]"
                    : s.simulated
                      ? "bg-[#f0b429]"
                      : "bg-[#3ee08a]"
                }`}
              />
              <span className="text-[#e6edf5]">{s.book}</span>
              {s.simulated && (
                <span className="text-[9px] text-[#f0b429] tracking-widest">SIM</span>
              )}
            </div>
            <div className="text-[#4a5766] tabular-nums">{s.count} markets</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ------------------------------- PRIMITIVES ------------------------------ */

function Panel({
  title,
  subtitle,
  right,
  children,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-[#141a21] bg-[#0b0f14]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#141a21]">
        <div>
          <div className="text-[11px] tracking-[0.22em] text-[#e6edf5]">{title}</div>
          {subtitle && (
            <div className="text-[10px] text-[#4a5766] mt-0.5">{subtitle}</div>
          )}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function RowHeader({ cols }: { cols: string[] }) {
  const template =
    cols.length === 7
      ? "grid-cols-[2.4fr_0.7fr_0.9fr_0.7fr_0.7fr_0.9fr_0.9fr]"
      : "grid-cols-7";
  return (
    <div
      className={`grid ${template} gap-2 px-3 py-2 text-[9px] tracking-[0.2em] text-[#4a5766] border-b border-[#141a21] bg-[#080c11]`}
    >
      {cols.map((c) => (
        <div key={c}>{c}</div>
      ))}
    </div>
  );
}
