# Labs explorers

The Judges’ Room and Road to UFC extend the Combined Record study. Both open
by default. Each room has its own filters, presets, comparisons, source rows,
CSV export, and collapsed methodology. Closing both suspends the insights
request. A failed request shows retry instead of presenting the previous
study as the current one.

The main study’s filters and individual exclusions apply first. Room filters
then slice that response locally, so exploring a scoreline or an arrival profile
is immediate and requires no further network request. Room state survives a
trip to a fighter or fight and Back, and closing/reopening a room.

## The judges’ room

One observation here is **one distinct bout**, even when both corners qualify
for the main study. The coverage line compares bouts with recorded scorecards
to all decision bouts selected by that study.

- Filter by final-panel verdict, scheduled length, judge, fight era, winner’s
  statistical deficit, scoreline, or fighter/event search.
- Presets open split decisions, wins with fewer strikes and less control, or
  five-round decisions. Presets replace room filters but keep the main study.
- Divided-panel rate is split plus majority panels divided by complete panels.
  Draws (including a three-way vote) and incomplete panels stay separate. All
  three final votes agreeing on a draw is a drawn panel, never a majority win.
- Compare divided-panel rates by five-year era or division. Fewer than 25
  complete panels gives a hatched bar.
- Judge rankings support card volume, dissent rate, or average absolute card
  margin, with minimum card samples of 1, 10, 25, or 100. The table exposes the
  exact counts. Dissent is a vote different from two matching votes (including
  draws); only complete three-card panels enter its denominator. Margin is an
  absolute difference in final scores, so scheduled length affects it.
- The scoreline fingerprint shows every scoreline, higher score first. Choosing
  a judge makes this chart describe that judge’s cards. Combining judge and
  scoreline requires the selected judge to have written that exact scoreline.
  Selecting a scoreline narrows bouts; all cards from those bouts remain
  available in the case file and CSV.
- “Won with less” means the recorded winner landed fewer significant strikes
  **and** had less control than the loser. Both totals must be known. Each bout
  enters both numerator and denominator once, regardless of selected corner.
- The case file is paginated, searchable and sortable by recency or the winner’s
  strike deficit. Expand a fight for every judge’s card, identified dissents,
  both fighters’ totals, and a link to the full matchup.

Only final scorecards are stored. We do not reconstruct individual scored
rounds or infer 10–8 rounds. Whole-fight totals and dissent do not establish
whether a verdict was correct. Judge assignments and eras are not controlled.

## The road to the UFC

Arrival facts count **unique fighters**. UFC performance counts **fighter-bout
observations**, using only results that survive the main study and exclusions.
Each fighter must have an identity-verified professional source history.

The arrival record is frozen immediately before the first indexed UFC bout,
using `completeRecordBefore`. This includes source ordering for same-day bouts
when the debut is linked to its source row. It must never use `fighter.outside`,
which includes outside-UFC bouts after the fighter’s debut and after leaving the
promotion. Unknown histories are excluded, never treated as zero experience.

- Filter by pre-UFC experience (0–7, 8–13, 14–21, 22+), age at debut (under 26,
  26–28, 29–31, 32+, or unknown), unbeaten record, debut era, time before the UFC,
  or fighter name. Unbeaten requires at least one prior professional bout.
- Measure matching results over the debut, first three UFC appearances, first
  five, or every appearance. The first-N window uses actual career appearance
  numbers, **not** the first N results remaining after filtering. It includes
  the available matching bouts; it does not require a completed N-fight career.
- Compare win rate or finish-win rate by experience, age, debut era, years before
  UFC, or unbeaten/loss/no-prior-bout groups. Both rates include draws and exclude
  no contests; finish-win rate is KO/TKO plus submission wins over all such
  results, not over wins only.
- The comparison marker uses verified fighters in the main study with the same
  result window. Other room filters do not narrow that baseline. Sample floors
  (5, 20, 50, 100 results) control hatching and eligibility for the leading-group
  takeaway; groups below the floor remain visible.
- The age × experience grid cross-filters the room with one click. To preserve
  comparison context, it keeps every age/experience band visible while applying
  all other room filters. Unknown ages are omitted from the grid and counted in
  its coverage note. Each cell states its rate and result count.
- Medians count each fighter once. Years before UFC runs from the earliest
  recorded prior pro bout to UFC debut. Unknown values stay unknown.
- The paginated fighter table carries debut date/division, arrival record, debut
  age, time before UFC, matching UFC record, and links to individual results and
  the fighter’s full history. CSV exports the entire filtered fighter slice.

These are descriptive comparisons, not causal effects. Different recruitment,
opponents, eras, longevity and source coverage affect the results. Counting
fighter-bouts gives longer careers more weight; switching to debut gives at
most one result per fighter.

## Verification

Server regression tests check real-archive reconciliation, global filters and
exclusions, distinct-bout denominators, pre-debut source ordering, and separate
handling of drawn/incomplete panels. Client tests cover composed room filters,
judge-specific scorelines, career-slot windows, unknown values, band boundaries,
unique-fighter medians, and win/finish denominators.
