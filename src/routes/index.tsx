import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyze,
  analyzeInsiderTrades,
  diffSharpMoves,
  snapshotMap,
  formatPct,
  formatMoney,
  toOdds,
  edgeAfterFees,
  type MarketRow,
  type Book,
  type SharpMove,
  type InsiderSuspect,
} from "@/lib/monitor-data";
import {
  getMonitorSnapshot,
  type MonitorSnapshot,
} from "@/lib/monitor-sources.functions";
import { fetchNansenInvestigation } from "@/lib/nansen-client";
import { CoffeeButton } from "@/components/CoffeeButton";

const monitorQuery = queryOptions<MonitorSnapshot>({
  queryKey: ["monitor-snapshot"],
  queryFn: () => getMonitorSnapshot(),
  staleTime: 0,
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Monitoor — TX Odds Surveillance Console" },
      {
        name: "description",
        content:
          "Real-time surveillance console comparing TX Odds against Polymarket and Kalshi. Flags sharp movements, arbitrage windows and mispriced markets.",
      },
      { property: "og:title", content: "The Monitoor — TX Odds Surveillance" },
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

type Tab = "arb" | "admin" | "godmode";

function MonitorPage() {
  const [tab, setTab] = useState<Tab>("arb");
  const [paused, setPaused] = useState(false);
  const [feed, setFeed] = useState<SharpMove[]>([]);
  const [showIntro, setShowIntro] = useState(true);

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
      {showIntro && <IntroModal onClose={() => setShowIntro(false)} />}
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
          <TabButton active={tab === "godmode"} onClick={() => setTab("godmode")}>
            GOD MODE
          </TabButton>
        </div>
      </div>

      <main className="mx-auto max-w-[1400px] px-4 py-4 grid grid-cols-12 gap-4">
        <section className="col-span-12 lg:col-span-8">
          {tab === "arb" ? <ArbView rows={rows} /> : tab === "admin" ? <AdminView rows={rows} /> : <GodModeView rows={rows} />}
        </section>

        <aside className="col-span-12 lg:col-span-4 space-y-4">
          <SharpTape feed={feed} />
          <BookHealth rows={rows} />
        </aside>
      </main>

      <footer className="mx-auto max-w-[1400px] px-4 pb-8 pt-2 text-[10px] text-[#4a5766] flex flex-wrap items-center gap-4">
        <span>THE MONITOOR v0.2</span>
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
        <CoffeeButton className="ml-auto flex items-center gap-2 hover:text-[#f0b429] transition-colors border border-[#1f2932] px-3 py-1 rounded cursor-pointer" />
        <span>·</span>
        <a href="https://x.com/mishastastna" target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-[#8ea3b8] transition-colors">
          <img src="/misha-pfp.jpg" alt="Misha Stastna" className="w-4 h-4 rounded-full" />
          Follow the dev! Misha Stastna
        </a>
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
          <img src="/tx-logo.jpg" alt="TX Logo" className="w-5 h-5 rounded-full" />
          <span className="h-2 w-2 rounded-full bg-[#3ee08a] animate-pulse" />
          <h1 className="text-[13px] tracking-[0.28em] font-semibold text-[#e6edf5]">
            THE&nbsp;MONITOOR
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
  const { keys, save } = useApiKeys();
  const [configOpen, setConfigOpen] = useState(false);
  const [executing, setExecuting] = useState<any>(null);
  const [pending, setPending] = useState<any>(null);

  const handleExecute = (d: any) => {
    if (!keys?.poly || !keys?.kalshi) {
      setPending(d);
      setConfigOpen(true);
    } else {
      setExecuting(d);
    }
  };

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
                <button 
                  onClick={() => handleExecute(d)}
                  className="border border-[#1f2932] hover:border-[#3ee08a] hover:text-[#3ee08a] px-2 py-1 text-[10px] tracking-widest">
                  EXECUTE ARB
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
      {configOpen && <ApiConfigModal onSave={(p, k) => { save(p, k); setConfigOpen(false); if(pending) setExecuting(pending); }} onClose={() => setConfigOpen(false)} />}
      {executing && <ExecutionModal trade={executing} onClose={() => setExecuting(null)} />}
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


/* ----------------------------- GOD MODE TAB ----------------------------- */

function GodModeView({ rows }: { rows: MarketRow[] }) {
  const suspects = useMemo(() => analyzeInsiderTrades(rows), [rows]);
  const [investigating, setInvestigating] = useState<InsiderSuspect | null>(null);

  return (
    <Panel
      title="GOD MODE — INSIDER TRADE DETECTION"
      subtitle="Flags suspected insider trades based on liquidity and probability outliers"
      right={
        <span className="text-[#ff5a6b] text-[11px]">
          {suspects.length} flagged
        </span>
      }
    >
      <div className="divide-y divide-[#141a21]">
        <RowHeader
          cols={["MARKET", "SUSPICION REASON", "DETAILS", "ACTION"]}
        />
        {suspects.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-[#4a5766]">
            no suspicious activity detected
          </div>
        )}
        {suspects.map((s, idx) => {
          const badgeCls =
            s.severity === "critical"
              ? "text-[#ff5a6b] border-[#ff5a6b]/40"
              : "text-[#f0b429] border-[#f0b429]/40";
          return (
            <div
              key={s.row.id + idx}
              className="grid grid-cols-[3fr_1.5fr_1.5fr_1fr] gap-2 px-3 py-2.5 text-[12px] hover:bg-[#0d1218]"
            >
              <div>
                <div className="text-[#e6edf5] line-clamp-1">{s.row.event}</div>
                <div className="text-[10px] text-[#4a5766] mt-0.5">
                  {s.row.outcome} · {s.row.category}
                </div>
              </div>
              <div className="flex items-center">
                <span
                  className={`text-[9px] tracking-widest px-1.5 py-0.5 border ${badgeCls}`}
                >
                  {s.trigger}
                </span>
              </div>
              <div className="text-[#8ea3b8] flex items-center">{s.details}</div>
              <div className="flex items-center">
                <button 
                  onClick={() => setInvestigating(s)}
                  className="border border-[#1f2932] hover:border-[#ff5a6b] hover:text-[#ff5a6b] px-2 py-1 text-[10px] tracking-widest">
                  INVESTIGATE
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {investigating && <InvestigateModal suspect={investigating} onClose={() => setInvestigating(null)} />}
    </Panel>
  );
}

/* --------------------------- INVESTIGATE MODAL ---------------------------- */

function InvestigateModal({ suspect, onClose }: { suspect: InsiderSuspect; onClose: () => void }) {
  const [phase, setPhase] = useState<"scanning" | "report">("scanning");
  const [report, setReport] = useState<{ thesis: string; history: any[] } | null>(null);

  useEffect(() => {
    let mounted = true;
    fetchNansenInvestigation({ data: suspect.trigger }).then((res) => {
      if (mounted && res) {
        setReport(res);
        setPhase("report");
      }
    });
    return () => { mounted = false; };
  }, [suspect.trigger]);

  const thesis = report?.thesis || "";
  const history = report?.history || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 font-mono text-[#d7e0ea]">
      <div className="bg-[#0b0f14] border border-[#ff5a6b] max-w-[700px] w-full p-6 shadow-[0_0_30px_rgba(255,90,107,0.15)] flex flex-col gap-6 relative overflow-hidden">
        
        {phase === "scanning" && (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <span className="w-8 h-8 rounded-full border-t-2 border-[#ff5a6b] animate-spin" />
            <div className="text-[11px] tracking-widest text-[#ff5a6b] animate-pulse">
              [SCANNING ON-CHAIN MOVEMENTS...]
            </div>
          </div>
        )}

        {phase === "report" && (
          <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between border-b border-[#ff5a6b]/20 pb-4 mb-4">
              <div>
                <h2 className="text-[#ff5a6b] text-xl font-bold tracking-widest">
                  INVESTIGATION REPORT
                </h2>
                <p className="text-[10px] text-[#4a5766] tracking-[0.2em] mt-1">{suspect.row.event}</p>
              </div>
              <button onClick={onClose} className="text-[#4a5766] hover:text-[#ff5a6b] tracking-widest text-[10px]">
                [CLOSE]
              </button>
            </div>

            <div className="space-y-6">
              <section>
                <div className="text-[10px] tracking-widest text-[#4a5766] mb-2 uppercase">Trigger Rationale</div>
                <div className="bg-[#ff5a6b]/10 border border-[#ff5a6b]/20 p-3 text-[12px] leading-relaxed">
                  <strong className="text-[#ff5a6b]">{suspect.trigger}:</strong> {suspect.details}
                </div>
              </section>

              <section>
                <div className="text-[10px] tracking-widest text-[#4a5766] mb-2 uppercase">Insider Thesis</div>
                <div className="bg-[#141a21] border border-[#1f2932] p-3 text-[12px] text-[#e6edf5] leading-relaxed">
                  {thesis}
                </div>
              </section>

              <section>
                <div className="text-[10px] tracking-widest text-[#4a5766] mb-2 uppercase">Wallet Trace / Cluster Activity</div>
                <div className="border border-[#1f2932] bg-[#0d1218] text-[11px]">
                  <div className="grid grid-cols-[1.5fr_1fr_1fr_1.5fr] gap-2 px-3 py-2 border-b border-[#1f2932] text-[#4a5766] bg-[#080c11]">
                    <div>TX HASH</div>
                    <div>TIME</div>
                    <div>SIZE</div>
                    <div>TYPE</div>
                  </div>
                  {history.map((h, i) => (
                    <div key={i} className="grid grid-cols-[1.5fr_1fr_1fr_1.5fr] gap-2 px-3 py-2 border-b border-[#1f2932]/50 hover:bg-[#141a21]">
                      <div className="text-[#3ee08a]">{h.tx}</div>
                      <div className="text-[#8ea3b8]">{h.time}</div>
                      <div className="text-[#f0b429]">{h.amt}</div>
                      <div>{h.type}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
            
            <div className="mt-6 flex justify-end">
              <button
                onClick={onClose}
                className="border border-[#ff5a6b] text-[#ff5a6b] px-6 py-2 text-[12px] font-bold tracking-widest hover:bg-[#ff5a6b] hover:text-[#0b0f14] transition-colors"
              >
                ACKNOWLEDGE
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------- INTRO MODAL ------------------------------ */

function IntroModal({ onClose }: { onClose: () => void }) {
  const handleClose = () => {
    onClose();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono">
      <div className="bg-[#0b0f14] border border-[#3ee08a] max-w-[650px] w-full p-6 shadow-[0_0_20px_rgba(62,224,138,0.1)] flex flex-col gap-4">
        
        <div className="flex items-center gap-4 border-b border-[#3ee08a]/20 pb-4 mb-2">
          <img src="/tx-logo.jpg" alt="TX Logo" className="w-12 h-12 rounded-full shadow-[0_0_15px_rgba(62,224,138,0.3)]" />
          <div>
            <h2 className="text-[#3ee08a] text-xl font-bold tracking-widest">
              WELCOME TO THE MONITOOR
            </h2>
            <p className="text-[10px] text-[#4a5766] tracking-[0.2em] mt-1">ADVANCED SURVEILLANCE CONSOLE</p>
          </div>
        </div>
        <div className="space-y-4 text-[#d7e0ea] text-[13px] leading-relaxed">
          <p>
            <strong>The Monitoor</strong> is an advanced prediction market surveillance console.
          </p>
          <p>
            <strong className="text-[#f0b429]">For Bettors:</strong> Spot arbitrage opportunities in real-time by comparing TXOdds against market consensus (Polymarket + Kalshi). Find mispriced lines before they adjust.
          </p>
          <p>
            <strong className="text-[#f0b429]">For TXOdds Admins:</strong> Ensure market integrity. Quickly identify when your lines drift significantly from the consensus, and spot suspected insider trades via the new <strong>God Mode</strong> tab.
          </p>
          <p className="border-l-2 border-[#3ee08a] pl-3 py-1 bg-[#3ee08a]/10">
            <em>With TXOdds permission, we can automate the market fixing itself, saving capital on mispriced markets instantly.</em>
          </p>
        </div>
        
        <AnimatedPreview />

        <div className="mt-8 flex items-center justify-between">
          <a href="https://x.com/mishastastna" target="_blank" rel="noreferrer" className="flex items-center gap-3 text-[#d7e0ea] hover:text-[#3ee08a] transition-colors group">
            <img src="/misha-pfp.jpg" alt="Misha Stastna" className="w-10 h-10 rounded-full border border-[#3ee08a]/30 group-hover:border-[#3ee08a] transition-colors" />
            <div className="flex flex-col">
              <span className="text-[10px] text-[#4a5766] tracking-widest uppercase">Follow the dev!</span>
              <span className="text-[13px] font-semibold">Misha Stastna</span>
            </div>
          </a>
          <div className="flex items-center gap-4">
            <CoffeeButton className="border border-[#1f2932] text-[#d7e0ea] hover:border-[#f0b429] hover:text-[#f0b429] px-4 py-2 text-[12px] font-bold tracking-widest transition-colors flex items-center gap-2 cursor-pointer" />
            <button
              onClick={handleClose}
              className="bg-[#3ee08a] text-[#07090c] px-6 py-2 text-[12px] font-bold tracking-widest hover:bg-[#3ee08a]/80 transition-colors"
            >
              ENTER SYSTEM
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnimatedPreview() {
  const [lines, setLines] = useState<{ text: string; type: string }[]>([]);

  useEffect(() => {
    const sequence = [
      { text: "[SYS] Initializing cross-book surveillance...", delay: 300, type: "info" },
      { text: "[SYS] Connected to Polymarket (gamma-api) [OK]", delay: 800, type: "ok" },
      { text: "[SYS] Connected to Kalshi (trade-api v2) [OK]", delay: 1200, type: "ok" },
      { text: "[SCAN] Analyzing active markets...", delay: 1800, type: "info" },
      { text: "[WARN] Whale detected: $250k liquidity on <10% outcome", delay: 2500, type: "warn" },
      { text: "[CRIT] Massive Divergence: 8.5pp spread on top market", delay: 3200, type: "crit" },
      { text: "[ACT] Executing automated market correction...", delay: 4000, type: "ok" },
      { text: "[SYS] Correction successful. Capital saved: $14,250", delay: 4800, type: "ok" },
      { text: "[SYS] Background monitoring active...", delay: 5600, type: "info" },
    ];

    let timeouts: ReturnType<typeof setTimeout>[] = [];
    let cumulative = 0;

    sequence.forEach((item) => {
      cumulative += item.delay;
      timeouts.push(
        setTimeout(() => {
          setLines((prev) => [...prev, item].slice(-6));
        }, cumulative)
      );
    });

    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div className="bg-[#07090c] border border-[#1a2129] rounded p-3 h-[130px] overflow-hidden relative shadow-inner mt-2 font-mono text-[10px]">
      <div className="absolute inset-x-0 top-0 h-6 pointer-events-none bg-gradient-to-b from-[#07090c] to-transparent z-10" />
      <div className="flex flex-col gap-1.5 justify-end h-full relative z-0">
        {lines.map((l, i) => {
          const color = l.type === "ok" ? "text-[#3ee08a]" : l.type === "warn" ? "text-[#f0b429]" : l.type === "crit" ? "text-[#ff5a6b]" : "text-[#8ea3b8]";
          return (
            <div key={i} className={`${color} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
              {l.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* --------------------------- TRADE EXECUTION MODALS --------------------------- */

export function useApiKeys() {
  const [keys, setKeys] = useState<{ poly: string; kalshi: string } | null>(null);
  
  useEffect(() => {
    const k = localStorage.getItem("monitoor_api_keys");
    if (k) setKeys(JSON.parse(k));
  }, []);

  const save = (poly: string, kalshi: string) => {
    const k = { poly, kalshi };
    localStorage.setItem("monitoor_api_keys", JSON.stringify(k));
    setKeys(k);
  };

  return { keys, save };
}

export function ApiConfigModal({ onSave, onClose }: { onSave: (poly: string, kalshi: string) => void; onClose: () => void }) {
  const [poly, setPoly] = useState("");
  const [kalshi, setKalshi] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-mono text-[#d7e0ea]">
      <div className="bg-[#0b0f14] border border-[#3ee08a] max-w-[500px] w-full p-6 shadow-[0_0_20px_rgba(62,224,138,0.15)] flex flex-col gap-6">
        <div>
          <h2 className="text-[#3ee08a] text-xl font-bold tracking-widest">CONFIGURE TRADING KEYS</h2>
          <p className="text-[10px] text-[#4a5766] tracking-[0.2em] mt-1">POLYMARKET & KALSHI REQUIRED FOR EXECUTION</p>
        </div>

        <div className="space-y-4 text-[12px]">
          <div className="flex flex-col gap-2">
            <label className="text-[#8ea3b8] tracking-widest text-[10px]">POLYMARKET PRIVATE KEY (POLYGON)</label>
            <input 
              type="password" 
              className="bg-[#141a21] border border-[#1f2932] px-3 py-2 outline-none focus:border-[#3ee08a]" 
              placeholder="0x..." 
              value={poly} 
              onChange={e => setPoly(e.target.value)} 
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-[#8ea3b8] tracking-widest text-[10px]">KALSHI API KEY</label>
            <input 
              type="password" 
              className="bg-[#141a21] border border-[#1f2932] px-3 py-2 outline-none focus:border-[#3ee08a]" 
              placeholder="Enter Kalshi API Key" 
              value={kalshi} 
              onChange={e => setKalshi(e.target.value)} 
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-4">
          <button onClick={onClose} className="text-[#4a5766] hover:text-[#e6edf5] text-[11px] tracking-widest">CANCEL</button>
          <button 
            onClick={() => { if(poly && kalshi) onSave(poly, kalshi); }} 
            className="bg-[#3ee08a] text-[#07090c] px-6 py-2 text-[12px] font-bold tracking-widest hover:bg-[#3ee08a]/80"
          >
            SAVE SECURELY
          </button>
        </div>
      </div>
    </div>
  );
}

export function ExecutionModal({ trade, onClose }: { trade: any; onClose: () => void }) {
  const [phase, setPhase] = useState("signing");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("routing"), 1000);
    const t2 = setTimeout(() => setPhase("success"), 2500);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4 font-mono text-[#d7e0ea]">
      <div className="bg-[#0b0f14] border border-[#3ee08a] max-w-[500px] w-full p-6 shadow-[0_0_30px_rgba(62,224,138,0.2)] flex flex-col items-center justify-center py-12 gap-6 text-center">
        {phase !== "success" ? (
          <>
            <span className="w-10 h-10 rounded-full border-t-2 border-[#3ee08a] animate-spin" />
            <div className="text-[12px] tracking-widest text-[#3ee08a] animate-pulse">
              {phase === "signing" ? "[SIGNING TX PAYLOADS...]" : "[ROUTING ORDERS TO KALSHI & POLYMARKET...]"}
            </div>
            <div className="text-[#8ea3b8] text-[10px] mt-2">
              Executing {trade.row?.event}
            </div>
          </>
        ) : (
          <div className="animate-in fade-in zoom-in duration-300 flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[#3ee08a]/20 flex items-center justify-center mb-4">
              <span className="text-[#3ee08a] text-xl">✓</span>
            </div>
            <h2 className="text-[#3ee08a] text-xl font-bold tracking-widest mb-2">ARB EXECUTED</h2>
            <p className="text-[#8ea3b8] text-[12px] mb-6">Successfully locked in +{edgeAfterFees(trade.spreadPP)?.toFixed(2)}pp edge.</p>
            <button 
              onClick={onClose} 
              className="border border-[#3ee08a] text-[#3ee08a] px-6 py-2 text-[12px] font-bold tracking-widest hover:bg-[#3ee08a] hover:text-[#0b0f14]"
            >
              CLOSE
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
