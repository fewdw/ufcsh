# Event media and broadcast crew

`client/src/components/EventMedia.tsx` owns the gallery, filters, one-line crew
strip and click-to-play modal. It is rendered below the event card; **Media &
broadcast** in the event heading jumps to it. Use `#event-media` for a direct
preview link. A card with no crew and no videos shows none of it: no panel, no
empty sections, no heading link. The crew strip pairs roles for display
(Commentary = play-by-play then color, Desk = host then analysts).

## Data and ordering

`GET /api/events/:id/media` is separate from the card request. Stored SQLite rows
are overlaid on reviewed starter data, keyed by event and YouTube video ID. The
starter data includes UFC 332 and UFC 333, so deploying the feature includes their
videos and sourced crews without copying a preview database.

Fight week is oldest first, using the stream start when YouTube provides it and
otherwise the exact publication timestamp. Uploaded recordings do not necessarily
reveal when an activity happened. Creator showcase is newest first. Both support
channel, category and before/after filters, with 12 cards at a time. Thumbnails
load lazily; no YouTube iframe loads before a video is selected. Closing the
modal removes the player. Unavailable embeds can still be opened on YouTube.

Categories distinguish official, ceremonial and unspecified weigh-ins. An
unspecified weigh-in never fills the official weigh-in coverage requirement.
Reactions published before a card are analysis, not post-fight results. Promotional
free fights retain their category even when an earlier fight's result is visible.

## Discovery and backfill

`MEDIA_SOURCES` in `server/src/scrape/event-media.ts` lists the selected publishers
by channel ID: UFC, TheMacLife, MMA Junkie, MMA Fighting, THE MMA GURU, Submission
Radio, Luke Thomas, Morning Kombat, Michael Bisping, Daniel Cormier, Anatomy of a
Fighter, and UFC on Paramount+. Add a channel only after verifying its identity.

Discovery searches those channels for the event, verifies candidates against
watch-page metadata, and retains exact dates, duration, uploader and video ID.
Numbered cards must match their exact number; Fight Nights must name both billed
opponents. Co-published videos are credited to the uploader returned by YouTube
and share one ID. Searches and watch reads use the existing throttled HTTP client.
Per pass: at most 30 search results per query and 55 candidates per publisher;
UFC and TheMacLife get additional fight-week category queries. This is a bounded
collection, not a claim to have indexed every YouTube upload or every page of results.

The background sync runs a media pass at most every 30 minutes, two events per
pass. Cards within 45 days refresh after six hours. Unread history gets priority,
newest first (about 800 cards, roughly eight days). A fully read card older than
45 days returns quarterly; one with a failed source, the next day. Retained videos
are re-checked weekly on recent cards and quarterly on old ones, so steady state
is roughly 1,500–2,000 YouTube requests a day (about 20–30 per recent-card
refresh, about 70 per old card each quarter). A first read of a recent Fight Night
took 19 searches and 24 watch pages, 43 seconds (2026-10-20). YouTube has its own
throttled host queue, so it never delays UFCStats or live results. Search failures preserve
existing videos and remain visible in Admin → Bugs. No API key is needed; changes
to YouTube markup/availability can require a scraper repair.

For a manual pass, use a development/private data directory:

```sh
DATA_DIR=/path/to/private-copy npm run backfill:event-media --prefix server -- --events=332,333
DATA_DIR=/path/to/private-copy npm run backfill:event-media --prefix server -- --event-id=EVENT_ID
DATA_DIR=/path/to/private-copy npm run backfill:event-media --prefix server -- --limit=10
```

To update versioned starter data, run from `server/` with
`--events=332,333 --export=src/event-media-data.ts`, then inspect the diff. Export
replaces that file with the selected events, so include every starter card to keep.

## Broadcast reports and gaps

Crew roles are event-specific and feed/language-labeled. Reviewed reports in
`event-broadcast-data.ts` take precedence over imports. Every media pass reads
Yahoo's MMA feed (`CREW_FEED`), which syndicates MMA Junkie's "broadcast team set"
reports in full a few days before each card. The feed spans about a day and a
half, so it must keep being read; Google News links in the news table can't be
followed. A report is assigned to one card: a numbered card by its number, a Fight
Night ("UFC Fight Night 291") by being the only non-numbered card in the next
seven days held in the city the report names.

Only the report's own role sections are read, under headings naming that card.
People are recognized as whole names from the fighter roster and `BROADCASTERS`,
or when introduced by their role ("correspondent McKenzie Pavacich"). Quotes and
the syndication footer are ignored. All six core roles are required; otherwise
nothing is stored and the report's link appears under Admin → Bugs (source
`crew`). Checked against the UFC 332, UFC 333, Fight Night 290 and 291 reports.
For an older or missed report:

```sh
DATA_DIR=/path/to/private-copy npm run backfill:event-media --prefix server -- --event-id=EVENT_ID --broadcast-url=https://sports.yahoo.com/path-to-event-report
```

Admin → Bugs includes coverage gaps for cards from the last 30 days and the next
week, source errors and unavailable videos, each with a re-read action. It asks
for crew roles from three days out; Countdown and Embedded on modern numbered
cards from four days out; media day, weigh-ins and press conferences after the
card; and a creator showcase from fight week. Optional workouts and a video from
every individual creator are not requirements. Older gaps are not reported: their
crew reports have left the feed. Preview repairs follow the launcher's existing
disabled-repair setting; the background sync likewise follows `NO_SYNC`. The seeded styling preview needs neither enabled.
