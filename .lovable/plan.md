# Plan: Wire Polymarket + Kalshi (free, no signup) into The Monitor

Replace the mock feed with real public data from Polymarket and Kalshi. No API keys, no billing. TX Odds stays as the "book under surveillance"; consensus is computed from Polymarket + Kalshi only. Sportsbook logic is removed from the UI (no Pinnacle/Betfair/etc.).

## Data sources

- **Polymarket** — CLOB REST, public, keyless.
  - `GET https://gamma-api.polymarket.com/markets?closed=false&limit=100` → list of active markets (question, slug, outcomes, tokenIds, category, volume).
  - `GET https://clob.polymarket.com/prices?token_id=<id>` → current YES/NO midpoint per outcome token.
- **Kalshi** — Trade API, public read, keyless for market data.
  - `GET https://api.elections.kalshi.com/trade-api/v2/markets?status=open&limit=200` → markets with `yes_bid`/`yes_ask`/`last_price` (cents, /100 = probability).
- **TX Odds** — existing `txline.txodds.com/documentation/worldcup` feed (kept mocked in this change; real wiring is a separate task once we have the auth details).

Both providers are same-origin-friendly from a server function, so we avoid CORS and can cache/throttle centrally.

## Architecture

```text
Browser ── useSuspenseQuery ──► /  route loader
                                 │
                                 └─► createServerFn: getMonitorSnapshot()
                                        ├─ fetch Polymarket gamma + clob
                                        ├─ fetch Kalshi markets
                                        ├─ fetch TX (mock for now)
                                        └─ normalize → MarketRow[]  (matched by title similarity)
```

- New `src/lib/monitor-sources.functions.ts` exporting `getMonitorSnapshot` (server fn, GET, no auth).
- New `src/lib/monitor-match.ts` — pure helpers: title normalization + fuzzy match to group Polymarket/Kalshi/TX quotes onto one `MarketRow`.
- `src/lib/monitor-data.ts` — keep types + `analyze` / `detectSharpMoves` / formatters. Drop `seedMarkets` and `tick` (or keep behind a `USE_MOCK` flag for offline dev). Trim `Book` union to `"TXOdds" | "Polymarket" | "Kalshi"`.
- `src/routes/index.tsx` — replace `useEffect`+`setInterval` mock loop with:
  - Loader: `ensureQueryData(monitorQueryOptions)`.
  - Component: `useSuspenseQuery` with `refetchInterval: 5000` for live updates; pause toggle sets `refetchInterval: false`.
  - Sharp-move tape becomes a client-side diff of consecutive snapshots (compare prev vs next probs, emit ≥1.5pp moves).
  - `BookHealth` panel updated to only list TXOdds / Polymarket / Kalshi.
- `errorComponent` + `notFoundComponent` on `/` (currently missing) since we're adding a loader.

## Behavior after change

- Arb Bettor tab: shows real Polymarket vs Kalshi vs (mock) TX spreads with edge after 0.5pp fee.
- TX Odds Admin tab: same rows, framed as "reset market to consensus".
- Sharp Tape: driven by real 5s deltas across Polymarket + Kalshi.
- Refresh cadence: 5s (well under either provider's public rate limits).
- No secrets required. No new dependencies.

## Out of scope (call out to user)

- Real TX Odds wiring — needs the auth/token shape from `txline.txodds.com`; will follow up once you share access.
- Sportsbooks (Pinnacle/Betfair/DK) — removed per your choice.
- Persisting history for longer sharp-move windows (would need Lovable Cloud).
