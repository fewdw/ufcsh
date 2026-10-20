# Event broadcast crew

`client/src/components/EventCrew.tsx` shows a card's crew on one line below the
event card, pairing roles for display (Commentary = play-by-play then color,
Desk = host then analysts). **Broadcast crew** in the event heading jumps to it
(`#event-crew`). A card without a crew shows neither. Data comes from
`GET /api/events/:id/crew`.

## Source

`server/src/event-crew.ts` reads Yahoo's MMA feed (`CREW_FEED`) every half hour
from the sync tick. Yahoo syndicates MMA Junkie's "broadcast team set" reports in
full a few days before each card. The feed keeps about a day and a half, so it
must keep being read; the Google News links in the news table can't be followed.
Reviewed crews in `event-broadcast-data.ts` take precedence over imports.

A report is assigned to one card: a numbered card by its number, a Fight Night
("UFC Fight Night 291") by being the only non-numbered card in the next seven
days held in the city the report names. Only the report's role sections are read,
under headings naming that card. People are recognized as whole names from the
fighter roster and `BROADCASTERS`, or when introduced by their role
("correspondent McKenzie Pavacich"). Quotes and the syndication footer are
ignored. All six core roles are required; otherwise no crew is stored, any
earlier crew is kept, and the report's link appears in Admin → Bugs. Checked
against the UFC 332, UFC 333, Fight Night 290 and 291 reports (2026-10-20).

## Archive

`server/src/event-crew-archive.json` holds crews for 67 cards from 2025-2026, keyed
by event ID, read from Yahoo's copies of MMA Junkie reports with this parser
(2026-10-20) and checked by role counts and spot reads. Yahoo carries none before
2025, and a few 2025-2026 reports use another layout (UFC 324), so those cards
show no crew. Precedence: `event-broadcast-data.ts`, then the archive, then crews
read from the feed. Older report layouts are handled too: photo captions are
skipped, a host is the person named beside "host"/"anchor", "joined by" lists
count, a changed plan ("instead of", "will not") drops only that sentence, and
series labels include "UFC on ESPN N"/"UFC on ABC N". A numbered card may be
announced up to two weeks out; a Fight Night only within the week.

## Gaps and manual imports

Admin → Bugs → **Event broadcast crew missing** lists cards from the last 30
days through three days ahead that lack a core role: "must" for today and
upcoming cards, "minor" afterwards. Its action re-reads the feed. For a report
that has left the feed, or an older card:

```sh
DATA_DIR=/path/to/private-copy npm run import:event-crew --prefix server -- --event-id=EVENT_ID --url=https://sports.yahoo.com/articles/...
```

Unsupported layouts are left for review; no crew is inferred from a usual
lineup. For those, add sourced roles to `event-broadcast-data.ts`.
