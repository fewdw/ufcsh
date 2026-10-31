# Polymarket

UFC.sh reads public market data only. It does not connect a wallet or place orders.

## Reader surfaces

- A coming card's Polymarket probabilities switch (`?markets=1` opens it directly).
- A matchup's Odds tab (`?tab=odds`): sportsbook moneylines/props and a Polymarket
  panel with the probability chart first, followed by source comparisons and
  source-listed props. The chart and comparison stay stacked at every screen size.
- During a live fight, the Result and Score tabs also include the compact chart.
- A finished bout keeps its Odds tab only when it has sportsbook prices, and shows
  the Polymarket panel only when a market was matched or prices were captured, so
  the archive before Polymarket's UFC markets shows no empty panels. A finished
  bout without a market is looked up again at most once a day.
- The hero badge is one line: the official Polymarket symbol and both percentages.
  It appears only while a fresh quote is available and the fight has no result.
  A result from the matchup feed hides it even if the price feed has not caught up.

There is no standalone Markets page, watchlist, follow UI, or replay slider.
Hover over the chart or focus it and use arrow/Home/End keys to inspect points.
The selected time uses a gray line; fixed-width percentage readouts keep fighter
labels still while inspecting prices. Touch gestures on the plot stay on the
chart: horizontal inspection does not scroll the page vertically. Range-mode
labels and the selected point’s source/timestamp line are omitted.
Drag the two arrow handles to select a time window, or drag the selection to pan.
Handles also support arrow/Home/End keys (Shift speeds up adjustment). No
All/Pre-fight/Live buttons are shown. Times use the viewer's browser time zone,
with the UTC offset on each timestamp to disambiguate daylight-saving changes.
The slim range navigator sits directly below the chart, with dates and UTC
offsets below it. There is no separate time-zone label. The raw observations dropdown and chart explanatory footer are omitted.

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
tracks the live bout, including sized order-book deltas, heartbeats and
reconnects. A bout is live as soon as the site calls it Live (`boutIsLive`: the
previous result landed, or the opener's start passed) or has evidence (feed,
Verdict or admin). Evidence alone arrives rounds late, after the price has
moved, and an admin hold still keeps a bout at Next. Shared REST reads provide
initial books and repair gaps. Additional data/history reads have a concurrency
limit of four; clients poll the shared server answer. Quotes expire after 15
seconds live and 90 seconds pre-fight and bypass persisted client page snapshots.
The visible Odds panel polls every five seconds during a live fight and every 15
seconds otherwise, after a request completes; hidden panels pause polling. Chart
captures are limited to one per ten seconds live, one per ten minutes before the
card's first start (matching source history buckets) and one per minute between
that start and the bout. A Gamma discovery outage keeps the last good mapping, so
current quotes and the live stream continue.

The archive contains three new tables:

- `polymarket_bouts`: matched market metadata and source/history diagnostics,
  guarded by the event/date/two-fighter identity.
- `polymarket_samples` (`WITHOUT ROWID`, read by its primary key): observed
  probabilities (cadence above) and source history, with provenance and bucket
  end times. Observed pre-fight rows also freeze sportsbook and community inputs.
- `polymarket_rounds`: first observed timestamp for each live round. These are
  observation times and may lag the broadcast. No historical round boundaries
  are guessed.

History uses the Data API v2 price-history endpoint and cursor pagination,
bounded to eight pages per read. Partial and failed reads stay visible. Source
history with unconfirmed live timing remains in the historical view; a bucket is
pre-fight only if its whole interval precedes the current card cutoff. Samples retain
their identity after a replacement and are excluded from the changed matchup.
History is retained for analysis; it is not reconstructed from results.

The matchup response carries every live capture and at most 1,500 other points,
the last of each equal time slice across the whole history, so a long-running
market keeps its full span (the newest point is always kept). It is recomputed
when a capture or history read lands, or after five seconds.

The chart uses `client/src/market-chart.ts` to validate, sort and deduplicate
observations. A live bout automatically switches to captured live observations
and shows all of them, so the window runs from walkout to the latest price. It
waits if none exist; it never guesses a fight start from the card cutoff. A
completed fight with live captures shows the whole captured fight, excluding
source settlement history; without captures it retains the full historical view.
Missing live minutes stay disconnected. Round markers use the first observed
round timestamps.

Manual ranges use absolute epoch milliseconds, so appending or backfilling history
does not shift the selected period. Handles cannot cross, extend outside the data,
or narrow below ten seconds (or the entire domain when shorter). A window without
samples stays empty. During a live fight, Follow live restores automatic behavior;
there is no Reset range button. Identity,
date, opponents, source URL or a transition into live scope resets the selection.
Pointer gestures freeze their coordinate mapping while polling continues.

The displayed probability is a midpoint or last trade. The Odds panel keeps
current percentages in the source-comparison table and chart, without repeating
a large probability summary, movement callout, trading metrics or explanatory
comparison banners. Additional markets are grouped by fight outcome, total rounds,
finish timing and round winners; unfamiliar types stay in Other. Each group is an
always-visible table with shared Yes/No or Over/Under headers and fixed-width
numeric columns. At 48rem of panel width, groups flow into two balanced columns without
empty grid rows. Smaller panels keep one column. Source links stay on each market
name. The unique higher listed price is emphasized when at least two prices are
available; ties and incomplete prices receive no emphasis. No discovery footer or
volume/liquidity summary is shown.

`client/src/market-groups.ts` aligns known binary outcomes by their source labels,
without deriving complements or changing probabilities. Incompatible outcome sets
get separate headers. Unknown or multi-outcome markets retain their original names,
order and prices; wide tables scroll locally on small screens.

## Comparisons

American sportsbook prices are converted to implied probabilities, then both
sides are normalized together to remove the margin. Community share counts
only picks for the same event and corner identities; it is a pick share, not a
calibrated forecast. The comparison omits community picks when the count is zero
or no community sample exists. The comparison has a bounded, horizontally centered
table without a visible section title. Blue/red fighter headers align with the
matching percentage columns; row dividers and uniform padding keep sources easy to
compare. Fresh
quote methods and sportsbook normalization timestamps are omitted; frozen or
unavailable prices retain their status labels. Community rows retain their pick
count without repeating a current-tally label.

A finished matchup shows the comparison frozen at its latest **observed**
pre-fight capture before the earliest announced card start (midnight UTC when
unknown). Sportsbook inputs are frozen only when no more than six hours old.
Imported history, settlement prices, post-cutoff samples and old matchup
identities never enter a frozen comparison; the cutoff is checked again when
reading, so a revised start does not admit a later capture. These captures are
kept so source accuracy can be scored later; there is no accuracy view yet.

Admin → Bugs → Odds includes unmatched markets and feed/history/identity gaps,
with a re-read action. Repairs invalidate the discovery/history timestamps;
the next request or background pass retries while preserving observations.

## Review on a development preview

Run `./start` and append the paths below to the printed Tailscale URL.

| Review | URL | What to check |
| --- | --- | --- |
| Upcoming matchup | `/fights/FIGHT_ID?tab=odds` | One-line logo/percentage badge, sportsbook comparison, draggable window, grouped props and hover/keyboard interaction |
| Completed matchup | `/fights/FIGHT_ID?tab=odds` | No hero badge; retained chart; full captured fight when available |
| Card | `/events/EVENT_ID?markets=1` | Expanded probabilities, hide/show and links into Odds |
| Live bout | `/fights/FIGHT_ID?tab=odds` | Whole capture since the bout went Live, captures only, Follow live after manual zoom |
| Return to Odds | Switch to Matchup and back | Same chart/range, no loading flash; hidden panels pause requests |

Test phone and desktop widths in both themes. The follow/open-market controls,
Markets navigation entry and replay slider should all be absent.

API references: [discovery](https://docs.polymarket.com/market-data/discover-markets),
[prices/history](https://docs.polymarket.com/market-data/prices-order-books),
[streaming](https://docs.polymarket.com/market-data/realtime-data).
