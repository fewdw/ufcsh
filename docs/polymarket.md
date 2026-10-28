# Polymarket

UFC.sh reads public market data only. It does not connect a wallet or place orders.

## Reader surfaces

- More → Markets (`/markets`): upcoming fight board, this browser's follows and
  alerts, historical accuracy, and other currently listed UFC markets.
- A card's Polymarket probabilities switch (`?markets=1` opens it directly).
- A matchup's Market tab (`?tab=market`): current probabilities, first observed
  pre-fight movement, sportsbook/community comparisons, price history, replay,
  observed round markers, source-listed props, and fight/fighter follows.
- During a live fight, the Result and Score tabs also include the compact chart.

## Data and timing

`server/src/polymarket-markets.ts` owns the shared market service on the API
thread. Discovery reuses `polymarket.ts`'s date and two-fighter matching, including
corner reversal and rejection of ambiguous/replacement pairings. Both legacy
token IDs and Protocol V2 position IDs are accepted. The existing live header
keeps its established price/result-hold behavior.

Current quotes come from CLOB order books. A single upstream market WebSocket
tracks the bout with confirmed live evidence (feed, Verdict or admin), including
sized order-book deltas, heartbeats and reconnects. Shared REST reads provide
initial books and repair gaps. Additional data/history reads have a concurrency
limit of four; clients poll the shared server answer. Quotes expire after 15
seconds live and 90 seconds pre-fight and bypass persisted client page snapshots.

The archive contains three new tables:

- `polymarket_bouts`: matched market metadata and source/history diagnostics,
  guarded by the event/date/two-fighter identity.
- `polymarket_samples`: observed probabilities (at most once per minute pre-fight,
  ten seconds live) and source history, with provenance and bucket end times.
  Observed pre-fight rows also freeze sportsbook and community inputs.
- `polymarket_rounds`: first observed timestamp for each live round. These are
  observation times and may lag the broadcast. No historical round boundaries
  are guessed.

History uses the Data API v2 price-history endpoint and cursor pagination,
bounded to eight pages per read. Partial and failed reads stay visible. Source
history with unconfirmed live timing is shown under All; a bucket is pre-fight
only if its whole interval precedes the current card cutoff. Samples retain
their identity after a replacement and are excluded from the changed matchup.
History is retained for replay and analysis; it is not reconstructed from results.

The displayed probability is a midpoint or last trade, not a buy quote. The
panel separately shows bid/ask, spread and ask depth within two cents. Props and
discovery show timestamped listed prices, not the fast moneyline feed.

## Comparisons and accuracy

American sportsbook prices are converted to implied probabilities, then both
sides are normalized together to remove the margin. Community share counts
only picks for the same event and corner identities; it is a pick share, not a
calibrated forecast.

Accuracy uses each completed fight's latest **observed** snapshot in the 24
hours before the earliest announced card start (midnight UTC when unknown).
Sportsbook inputs must be no more than six hours old and community samples need
at least ten picks. All three sources are scored on the same eligible fights.
Imported history, settlement prices, post-cutoff samples, draws, no contests,
and old matchup identities cannot enter the scores. The cutoff is checked again
when reading, so a revised start does not admit a later snapshot. Finished
matchups show frozen comparisons where available. The first-listed fighter is
the reference outcome; exact 50/50 calls remain in Brier but abstain from winner
accuracy. Coverage accumulates prospectively; there is no invented backfill.

Admin → Bugs → Odds includes unmatched markets and feed/history/identity gaps,
with a re-read action. Repairs invalidate the discovery/history timestamps;
the next request or background pass retries while preserving observations.

## Follows and alerts

Follows, thresholds, cursors and the last 100 alerts are stored in this browser.
The monitor runs across the app while it is open and visible. Following a fighter
includes its upcoming matchups; following a fight tracks that fight alone.

Movement/favourite alerts require two distinct fresh observations at least five
seconds apart, a spread at most six points, and at least $100 of ask depth within
two cents. Favourite changes cross a 48%/52% band to reduce flapping. A changed
market or pairing resets the baseline. After an alert, the new price becomes the
baseline. Thin/stale/closed markets cannot trigger alerts. This is an in-app feed,
not background push or account-synced storage.

## Review on a development preview

Run `./start` and append the paths below to the printed Tailscale URL. Real
fights/cards can be opened from the board; their Market tab and card switch
also have direct URL parameters.

| Review | URL | What to check |
| --- | --- | --- |
| Real matchup | `/fights/FIGHT_ID?tab=market` | Freshness, source comparison, chart filters/slider, props, follow buttons |
| Card | `/events/EVENT_ID?markets=1` | Expanded probabilities, hide/show, links into the matching Market tab |
| Live demo | `/markets?demo=live` | Round markers, live-range default, keyboard/touch slider, confirmed alert test |
| Comeback demo | `/markets?demo=replay` | Winner's 12% low, timeline replay, closed-state copy |
| Thin demo | `/markets?demo=thin` | Warning, last-trade label, alert test suppressed |
| No market | `/markets?demo=missing` | Honest empty state; comparison remains available |
| Offline | `/markets?demo=offline` | No current quote; captured history remains usable |
| Watchlist | `/markets?view=watchlist` | Follow the real fight/fighter, change threshold, reload, remove, read alerts |
| Accuracy | `/markets?view=accuracy` | Empty prospective coverage and methodology; populated examples below each demo |
| Other markets | `/markets?view=explore` | Real available props/questions, source timestamps, external links |

Demos are dev-only, clearly fictional, and never write to the archive or real
watchlist. Try a phone and a desktop in both themes. Useful refinement feedback:
the URL/scenario, screen width/theme, what felt unclear, and the desired behavior.

API references: [discovery](https://docs.polymarket.com/market-data/discover-markets),
[prices/history](https://docs.polymarket.com/market-data/prices-order-books),
[streaming](https://docs.polymarket.com/market-data/realtime-data).
