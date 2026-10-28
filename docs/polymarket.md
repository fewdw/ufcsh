# Polymarket

UFC.sh reads public market data only. It does not connect a wallet or place orders.

## Reader surfaces

- A card's Polymarket probabilities switch (`?markets=1` opens it directly).
- A matchup's Odds tab (`?tab=odds`): sportsbook moneylines/props and a Polymarket
  panel with the probability chart first, followed by source comparisons and
  source-listed props.
- During a live fight, the Result and Score tabs also include the compact chart.
- The hero badge is one line: the official Polymarket symbol and both percentages.
  It appears only while a fresh quote is available and the fight has no result.
  A result from the matchup feed hides it even if the price feed has not caught up.

There is no standalone Markets page, watchlist, follow UI, or replay slider.
Hover over the chart or focus it and use arrow/Home/End keys to inspect points;
its range buttons remain available. The raw observations dropdown and chart
explanatory footer are omitted.

The visited Odds panel stays mounted for the current bout, preserving the chart
range across tab changes. Hidden panels pause their requests; returning refreshes
in place when due. Quote expiry still uses the source timestamps. Legacy
`?tab=market` links open the combined Odds tab.

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

The displayed probability is a midpoint or last trade. The Odds panel keeps
current percentages in the source-comparison table and chart, without repeating
a large probability summary, movement callout, trading metrics or explanatory
comparison banners. Props show timestamped listed prices.

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

## Review on a development preview

Run `./start` and append the paths below to the printed Tailscale URL.

| Review | URL | What to check |
| --- | --- | --- |
| Upcoming matchup | `/fights/FIGHT_ID?tab=odds` | One-line logo/percentage badge, sportsbook comparison, chart range and hover/keyboard interaction |
| Completed matchup | `/fights/FIGHT_ID?tab=odds` | No hero badge; retained price chart and source observations |
| Card | `/events/EVENT_ID?markets=1` | Expanded probabilities, hide/show and links into Odds |
| Return to Odds | Switch to Matchup and back | Same chart/range, no loading flash; hidden panels pause requests |

Test phone and desktop widths in both themes. The follow/open-market controls,
Markets navigation entry and replay slider should all be absent.

API references: [discovery](https://docs.polymarket.com/market-data/discover-markets),
[prices/history](https://docs.polymarket.com/market-data/prices-order-books),
[streaming](https://docs.polymarket.com/market-data/realtime-data).
