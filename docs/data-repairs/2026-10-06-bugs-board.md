# Bugs board repairs — October 6, 2026

Measured on a production snapshot with every event article re-read by the new
parsers (787 archived articles): nothing critical or must before or after.

| Check | Before | After |
| --- | ---: | ---: |
| Missed weight at or under the division limit | 6 | 1 |
| Replacements without the fighter they replaced | 146 | 99 |
| Replacements without their days' notice | 1,165 | 999 |
| Replaced fighters without a profile | 63 | 18 |
| One person with two profiles | 1 | 0 |
| UFC roster timeline evidence | 4,682 | 3,241 |

- **Weigh-ins.** "128, 129, 160 and 120 pounds, respectively" gave all four
  fighters 120 lb (UFC Fight Night: Werdum vs. Tybura). UFC 308 swapped Hugo's
  and Basharat's weights: the fighter named only in "the bout between X and Y"
  no longer counts, and a semicolon ends a clause. Daniel da Silva's miss was
  given to Erik Silva (UFC 282). Two misses after semicolons at UFC Fight
  Night: Lewis vs. Daukaus were found. Across all articles six cards change,
  each a correction.
- **Replacements.** Months, "COVID-19", "Therefore", "One", divisions and
  venues were stored as the replaced fighter ("Replaced February"). "He"/"she"
  is now the fighter just reported withdrawing, or the one the replacement's
  opponent was booked against. Hyphenated and particle surnames
  (Al-Selwady, du Plessis) and an article's one-letter misspelling
  (Cunninham) are completed. A bout replaced by a bout, and a sentence opening
  with a date after the card, name nobody. 172 cards change; every removed
  value was checked as wrong.
- **Notice.** A replacement sentence that dates the change ("On October 24,
  … was replaced by"; "withdrew on December 10 and was replaced by") gives the
  days to the event, up to 60.
- **Replaced fighters' profiles.** Name matching also tries spacing and
  family-name order (B.J. Penn, Choi Seung-woo), longer stored names
  (Waterson-Gomez), a middle name used first, a short given name and former
  names from the search aliases.
- **Ramiro Jimenez.** His UFCStats page has no bout; the signee is the only
  profile shown, so the board no longer counts the hidden page.
- **Roster timeline.** `server/src/roster-history-wikipedia.json` holds 2,029
  dated signings and releases from 830 weekly revisions of "List of current
  UFC fighters" (2017 on from the date column; earlier releases only through a
  cited report whose title names the fighter and says released, cut or
  retired). Each links to its revision and is kept only for a single matching
  UFC fighter whose bouts bear it out: a UFC bout within 550 days after a
  signing, or within 800 days before a departure. `node
  src/import-roster-history.ts` rebuilds it.

- **Rankings.** ufc.com's media Women's Flyweight list has the champion and
  then 2 to 15, #1 left empty. The parser took it for a page caught mid-update
  and failed the whole sync, so no division had updated since Oct 5, 16:00
  UTC. One empty place (fourteen distinct ranks ending at 15) is now accepted.

Startup re-reads every completed card's article (`migration_bout_changes` 3)
and the weigh-ins of cards with a stored miss (`migration_weight_miss_namesakes` 2).

## Left as they are

William Knight's 218 lb at heavyweight is real (his light heavyweight bout
moved up). Most remaining replacements are articles that never say whom or
how far out. Pre-2017 signing dates have no dated source in the roster
article. UFC 333's lines, Oct 10 by-round props, missing photos and stances
wait on their sources.
