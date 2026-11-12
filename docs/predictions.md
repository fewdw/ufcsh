# Fight predictions

Matchups keep their **Predict** tab after completion so fan predictions remain
visible. A signed-in fan can choose a winner before predictions close,
optionally KO/TKO, submission or decision, and optionally a finish round for
KO/TKO or submission. Round choices require a confirmed three- or five-round
format. The app shows each fighter's current odds and potential points before
saving. A fighter without a usable moneyline cannot be picked until odds arrive.

One prediction is stored per user and fight in `scoring.db`, alongside their
scorecards. Edits replace the previous pick. Removed picks retain a revision
tombstone so a stale tab cannot restore them. No prediction is imported or
generated on behalf of a user; Verdict MMA's picks join only the community
charts, as a total (below).

## Verdict MMA picks

Verdict MMA has taken fan picks on every UFC main card since UFC 205 (November
2016) and on prelims too since 2024. `verdict-picks.ts` stores them on the bout
(`fights.verdict_picks_json`, in our corner order, with the two fighter ids it
was matched to). The community picks panel shows one combined winner pie, one
combined method pie and one round/decision bar chart. Round percentages use
all picks: decisions from both sources go under
DEC; picks without a published finish round go under ?. Verdict publishes no
finish-round totals, so its knockout/submission picks stay unspecified. The
round chart stays visible when Verdict picks are included, even if there are
no local picks.

Verdict publishes no counts. Its public `/api/v1/fight` prices every option as
total ÷ picks on it, to two decimals (4.2 when nobody picked it), and names the
most common exact ballot with its count. `verdictPickCounts`
(`scrape/verdict-picks.ts`) finds every total those prices allow and gives each
option a whole count inside the range its price allows, so the stored counts
reproduce every published price (bar a rare exact half-cent tie, which is
harmless to the counts). `least` is the smallest total allowed and
`exact` says it is the only one: true for about 40% of bouts. Prices that fit no
total give no counts at all. A decision on top
pins the total to within 0.005 ÷ its price (about 0.3% or less), unless
Verdict's winner-only quick picks (filed as decisions, round 0) put that
option above its ballot: then the solver allows up to 10% more, gives the
least and never calls it exact. A single strict total is called exact only if
quick picks couldn't also fit one up to 1% higher; a finish on top leaves totals up to two or three
times the least. The panel shows an exact total as is and any other as the
least, to three figures rounded down. The displayed count omits a `+`, but
remains an estimate when `exact` is false. Percentages are within about
0.3 points of the shares the prices state either way.

Trust over time:

- Only Verdict's live UFC cards are matched (`eventAssociation` containing
  "UFC", or "TBD" while a card is being set up; `eventActive` not 0): another
  promotion's bout the same weekend can share surnames and initials, and a
  copy Verdict has retired holds a sliver of the card's picks. A card that
  turns out otherwise loses the splits it stored.
- Verdict may list one bout on two live cards (both halves after a move): the
  split from the larger poll is kept, whichever card is read (or finishes) last. A card that
  no longer lists one of our bouts (or lists no bouts at all) clears the split
  it stored there. A card that had bouts and reads empty is noted in Admin →
  Bugs and read again a day later (an archive card too); only when that read
  agrees are its splits cleared and the note dropped. A response missing the
  bout or its date is an error, never "no bouts".
- A bout is matched only when both fighters' names agree (tier 1 of
  `alignment`, aliases included), or one does and the other is Verdict's own
  spelling of the same fighter (`nearName`: "Charles Olivera", "Sumudaerji
  Tibetan Eagle", "Muhammad Said"). A shared first name is never enough, so
  Ferguson–Johnson never lands on Ferguson–Chandler. A stored split is shown
  only while the bout still has the two fighters it was matched to, and only
  in the current `VERDICT_PICKS_FORMAT`.
- Prices that fit no total are never stored. While picks are open the bout is
  read again two seconds later and otherwise keeps its last good split; once
  final, that Verdict bout's split is cleared, as is one Verdict no longer
  gives picks for. A card Verdict added after it was fought took no picks and
  never clears another card's split.
- Each card keeps Verdict's bout list. Every six hours, finished cards' unread
  bouts are matched again, so a card of ours loaded later (or a name fixed) gets
  its picks without the card being read again. A rematch that fails keeps its
  error on the card (Admin → Bugs) until one succeeds.
- The sync, the backfill and Admin's repair may read cards at once, so each
  write is decided in one statement against what is stored then: nothing from
  a read of a card that has been read again since (`read_at`); over the same
  Verdict bout's split, only a later read; over another card's split for the
  same two fighters, only a poll at least as large. A cleared split is kept as
  a dated marker (never shown), and the rematch only updates a card no read
  has touched since.
- Cards still taking picks are found hourly on Verdict's events page and read
  hourly, every ten minutes from the day before, until the card is over; then
  the split is final and not read again. A card whose final read was missed is
  read until one succeeds, for a month. A card no bout of ours matches yet
  (still being announced, or a placeholder dated years ahead) is read daily,
  hourly in its last week; a matched one daily until five weeks out (the
  Predict tab takes picks for the next three cards, up to about four weeks).
  A final card Verdict lists again as not started reopens if it was re-dated,
  or if it was set aside and the listing now shows it as a live UFC card. A failed read never un-finals a card. The panel says when open picks were
  last read.
- Every other card is read once by a walk over Verdict's event ids, one per 30
  seconds; `npm run backfill:verdict-picks` does the whole archive in about half an
  hour (two workers, a quarter-second pause per card, to spare the host that
  also serves fight-night scoring). Changing what is stored means bumping `VERDICT_PICKS_FORMAT` in
  `predictions.ts`: older splits stop showing and every card is read again.
- The walk gives up on a card after three lasting failures running (not a
  dropped connection, timeout, 401/403, rate limit or server error, so never
  over an outage); it stays in Admin → Bugs. A card dated before UFC 205 was added later and isn't read bout
  by bout or rematched, even if a stray pick landed on it; any later card is,
  so a pickless bout never hides the rest.
- A pass in which every card read fails (even if Verdict's events page still
  loads) is reported to Admin's sync status; a pass that read nothing neither
  clears nor extends that. Admin →
  Bugs lists failed reads ("Verdict picks reads that failed") and "Verdict
  picks that may be wrong": open cards more than three hours overdue on their own
  schedule, and finished
  cards with bouts whose prices fit no total. Many of the latter at once means
  Verdict changed how it prices picks.

## Closing picks

The server sorts the current card into actual fight order (largest `ord` first).
When a bout goes live, predictions close for that bout and the next two bouts.
The night's first bout closes **15 minutes before its card section starts**:
for example, a 5 PM early-prelims start means a 4:45 PM deadline. The opener's
own early-prelims, prelims or main-card section supplies that timestamp; if its
section is unknown, the earliest announced event start is used. The Predict tab
shows the deadline in the viewer's timezone. This early deadline applies only
to the first bout of the night, not the first bout of each later section.
The second bout still closes at the announced event start; the third also closes
then because the first bout is its trigger. If no start is available, those
early picks close at 00:00 UTC on the event date. Later bouts follow live progress.
Between bouts, a completed result advances the cutoff to the next bout, rather
than waiting for that next bout's delayed round feed. A card whose expected
start is over 36 hours old closes entirely even if its feed is incomplete.

The source is the same UFCStats live feed used by the app, so real-world starts
can precede the feed update. Every save and removal checks the latest stored
card inside the write transaction. Observed locks persist in `prediction_locks`
and never reopen if the feed regresses. The browser polls every three seconds;
its displayed state does not authorize a write after a server lock.

## Points (version 1)

All picks risk **100 points**, with no money involved:

- A correct fighter earns the moneyline payout for a 100-point stake: +200 odds
  earn 200 points; −200 odds earn 50 points. The original stake is not added.
- Correct method adds 50% of that fighter payout.
- Correct method **and finish round** adds another 50% of that payout.
- A wrong fighter loses 100 points. Wrong or omitted methods/rounds cost nothing.
- Decisions have a method bonus but no finish-round bonus.
- Draws, no contests, removed bouts, cancelled bouts and changed opponents are
  void for zero points. A disqualification can earn winner points, but none of
  the offered method bonuses.

Amounts round to two decimals at each component. Odds, component values, fighter
identities and rule version are saved with the pick. An edit uses the current
odds, and the server rejects a submission if those odds have changed since the
displayed quote. Client-provided point values are ignored. Fighter identity,
rather than corner position, determines the winner, so a corner swap does not
change a pick. Points are computed from the saved quote and the current official
result; there are no incremental credits that can be awarded twice. Corrected
official results immediately change the calculated points.

## Profiles and API

**Predictions** appears beside **Scorecards** on public profiles, with cumulative
points, right/wrong/pending/void counts and every saved pick. The list pages 25
at a time; the totals include the whole history. Each row links back to its
fight's Predict view, which also remains available in the fight's tabs after completion.
The account menu also links directly to **My predictions**.

```
GET    /api/fights/:id/predictions
GET    /api/fights/:id/predictions/mine
PUT    /api/fights/:id/predictions/mine
DELETE /api/fights/:id/predictions/mine
GET    /api/profiles/:handle/predictions?offset=0
```

PUT accepts `{ revision, fighterId, method, round, line, matchupKey }`; method/round are
nullable. DELETE accepts `{ revision }`. Own-pick routes use the existing Clerk
bearer-session authentication, origin restrictions and account ownership. JSON
is limited to 4 KiB, and reads/writes are rate limited. Responses use `no-store`
so an old response cannot advertise an expired deadline. Public profile responses
never contain the private Clerk user ID.

`server/src/predictions.test.ts` tests ordering, cutoffs, persisted locks, odds,
all scoring branches, corrections, replacements, edits/removals, stale revisions,
account isolation and the authenticated HTTP workflow using an isolated database.
