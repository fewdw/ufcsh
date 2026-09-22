# Fight predictions

Upcoming matchups have a **Predict** tab. A signed-in fan can choose a winner,
optionally KO/TKO, submission or decision, and optionally a finish round for
KO/TKO or submission. Round choices require a confirmed three- or five-round
format. The app shows each fighter's current odds and potential points before
saving. A fighter without a usable moneyline cannot be picked until odds arrive.

One prediction is stored per user and fight in `scoring.db`, alongside their
scorecards. Edits replace the previous pick. Removed picks retain a revision
tombstone so a stale tab cannot restore them. No prediction data is imported or
generated on behalf of users.

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
fight's Predict view, which remains readable after completion through that link.
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
