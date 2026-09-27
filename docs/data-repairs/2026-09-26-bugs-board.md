# Bugs board repairs — September 26, 2026

Production's `/admin?tab=bugs` fell from **4,796 open items to 3,307** (critical 1 → 0) after the source fixes in PR #29 and the one-off repairs below. A pre-repair copy of the database is at `/data/backups/bugs-board-repair-ufc-20260926T2242Z.db`.

| Check | Before | After |
| --- | ---: | ---: |
| Fights missing community scorecards | 3,755 | 2,257 |
| Active fighters without a verified history | 2 | 0 |
| Events with no venue | 16 | 0 |
| Fight-week bouts with no referee assigned | 11 | 0 |
| Officials who may be one person | 4 | 2 |
| Official names merged from several spellings | 3 | 2 |
| Venue in a different city from the card (new) | 69 found | 0 |

Three "UFC fights missing from a verified history" items are last night's results, which Sherdog had not yet posted; they clear on the next career refresh.

## What was wrong

- **ufc.com pages.** 58 completed cards held another event's ufc.com page, and 13 more pages led to another event's live feed. Those cards showed the other event's venue, broadcasters, start times and segments. Segment reads now reject a page or feed that shares no bout with our card.
- **Verdict community cards.** Every stoppage's community card was dropped: cheerio's `map()` discards nulls, so the "TKO" cell vanished and the total shifted into a round.
- **Wikipedia infobox.** Stored TUF season titles were re-read whole (the show's infobox, no venue), multi-line citations ended the infobox early (lost gate and attendance), and `{{nowrap|…}}` venues were dropped.
- **Sherdog.** Search returned Sphinx errors, so Luis Hernandez (fighting that night) could not be verified. Booked fighters are now also found on their opponent's verified page.

## Repairs run

1. Backup via `VACUUM INTO`.
2. `career` repair for Luis Hernandez and Cristian Perez: both verified.
3. Re-read of 355 event articles missing a venue, gate or attendance: venues 36 → 1 missing, gates 338 → 309, attendance 230 → 203.
4. Every completed card's ufc.com page checked against its bouts (617 checked, 58 forgotten, 91 list no bouts), the archive walked again to re-match them, then every completed card's page and feed re-read with the new checks (13 foreign feeds cleared).
5. `node src/backfill-verdict-scorecards.ts --max=2300 --concurrency=3`: 1,869 community cards added.

## Left as they are

Checked against the sources, not fixable here: MMA Decisions has no round scores for the remaining partial panels (566 pages read, none usable); the unnamed judges are "Unknown Judge" there too; BestFightOdds never listed UFC 318's undercard, the July 2025 props, or the upcoming bouts still without lines; Gary and Gerald Ritter stay separate.
