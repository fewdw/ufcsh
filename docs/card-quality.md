# Card quality, version 4

This is an editorial rating of a whole event, not a factual measurement of
entertainment or a probability. Completed cards are reviews; announced cards
are estimates. The title stars expose the exact score, input coverage and
factor breakdown on hover/focus. No extra score tile is added.

Version 3 stopped reading a card as a flat list of bouts. A card is its top:
the main event carries six times the weight of a prelim, the headline bouts are
read a second time on their own, and the main event is a factor in its own
right. An announced card with fewer than six bouts is not rated at all.

Version 4 fixed what that left too harsh, and states one preference outright:
a decision the promotion called the Fight of the Night is no longer scored as a
dud, a reigning champion competing counts as part of what is at stake, lineup
strength and card depth are read against the range they actually take across
the archive, the scale is anchored so the median card on record reads as an
average night at 50, and the card's make-up carries an editorial adjustment
toward the men's divisions.

## Not every bout is the card

Bouts arrive in card order, main event first, and each carries a weight:

| Place | Main | Co-main | 3rd | 4th | 5th | 6th | Everything below |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Weight | 3.0 | 2.1 | 1.6 | 1.35 | 1.2 | 1.1 | 0.5 |

Every card-wide measure — lineup strength, competitive matchups, entering form,
action, finishes, and the no-contest deduction — is a weighted mean over those
weights, and each fighter inherits the weight of the bout they are in. On top of
that, those measures are blended 70/30 with the same measure taken over the top
two bouts alone (main event 2, co-main 1), 65/35. A dull opener is normal and
costs almost nothing; a dull main event is what people mean when they say a
card was bad. Card depth is the one exception: it asks how much card there is,
so it reads every bout evenly.

## The make-up of the card

The weighted total carries one further adjustment: up to five raw points off in
proportion to the position-weighted share of women's bouts, so an all-women's
card reads about twelve points below the same card of men's bouts and a single
women's bout on a men's card costs almost nothing. This is a stated editorial
preference of the rating, in the same sense as the weight given to a main event
over an opener. It measures nothing, and it is applied once, where it can be
seen, rather than folded quietly into the factors.

## Announced cards (estimate)

| Factor | Weight | Evidence |
| --- | ---: | --- |
| Main event | 12% | The headliner on its own terms: both fighters' credentials 35%, their prior finishing 25%, what is at stake 20% (a belt 1.00, an interim belt 0.85, anything else 0.35), and how close the matchup is 20%. |
| Lineup strength | 20% | UFC wins and experience, win rate shrunk toward 50% for small samples, reigning/former champions, and current Meta ranks. |
| Ranked fighters | 11% | Each fighter's standing in the canonical Meta feed: champion 1.00, interim champion 0.95, #1–#15 sliding 0.95→0.70, everyone else 0.10. Counted per fighter, so four ranked names beat one. Without a rankings feed the factor is unknown, not zero. |
| Competitive matchups | 12% | Margin-free probabilities from both closing/latest available odds. Without prices, a conservative comparison of the two fighters' credentials substitutes. An extreme underdog price is not automatically good matchmaking. |
| Championship stakes | 9% | Recognized undisputed/interim title bouts, capped at three, and worth less on the prelims than at the top. TUF/tournament finals are excluded. Champions themselves are counted once, under Ranked fighters. |
| Entering form | 5% | Winning/losing streaks; established unbeaten UFC records add a limited boost. Debuts have unknown UFC form, not a zero. |
| Card depth | 5% | Number of bouts, capped at twelve, plus average lineup strength across the whole card. Adding weak bouts can dilute the average instead of guaranteeing a better score. |
| Expected action | 14% | Each fighter's earlier UFC significant-strike pace, knockdowns and submission attempts, weighted 55/25/20, each from its own timed sample. |
| Finishing potential & activity | 12% | Smoothed prior finish rates tilted toward fighters who finish by strikes (a record of knockouts reads up to 15% above the same rate of submissions), plus activity/layoff, 80/20. |

## Completed cards (review)

| Factor | Weight | Evidence |
| --- | ---: | --- |
| Main event | 12% | What the headliner actually was: how it ended 45% (on the same scale as above, Fight of the Night decisions included), its own action rate 22%, what was at stake 20%, and 13% for an underdog win or a Fight of the Night bonus. |
| Lineup strength | 20% | As above, from each fighter's state entering the bout, and read against the 0.40–0.80 band the measure actually occupies across the archive. Today's rankings are never applied to a past card. |
| Competitive matchups | 12% | As above, from the closing prices. |
| Championship stakes | 10% | Recognized title bouts, capped at three and worth less on the prelims, plus the share of reigning champions who competed — read like every other measure, so a champion headlining counts for more than one on the prelims. |
| Entering form | 5% | As above. |
| Card depth | 5% | As above, read against its own 0.50–0.85 archive band. |
| Action delivered | 16% | The bouts' own significant-strike, knockdown and submission-attempt rates over elapsed time, weighted 55/25/20. |
| Finishes, upsets & bonuses | 20% | Finishes 65%, underdog wins 20%, Fight of the Night 15%. A knockout scores 1.00, a submission 0.75, a decision 0 — except a decision that won Fight of the Night, which scores 0.60: it was not a dull fight, it only failed to end early. Disqualifications, overturned results and unrecorded methods are unknown rather than decisions, and shrink toward neutral. |

The main event is deliberately counted twice: once inside every card-wide
measure, at triple weight, and once as its own factor. That is the point of the
model — a card is remembered for the fight it is named after.

There is no ranked factor on a review. The rankings feed holds only today's
top fifteen with no archive, so applying it to a 2014 card would rate that
night with facts that did not exist yet. What was true then — belts held
entering the bout — is counted under championship stakes instead.

Each factor is bounded to 0–1. Missing numerical observations contribute a
neutral 0.5 and reduce reported coverage; coverage is not statistical confidence.
Completed cards receive up to an eight-raw-point deduction for no contests,
weighted by where on the card they happened.

## Cards too early to rate

An announced card with fewer than **six** bouts carries no rating and no stars.
Two booked fights say nothing about the evening they will belong to, and dim
stars read as a verdict when there isn't one. Between six and eight bouts the
card is rated tentatively: its weighted total is blended toward the neutral
total of 50 in proportion to how much of a card exists, reaching its own full
value at eight. A finished card is never shrunk this way — a short card in 2002
really was a short card, which card depth already reflects.

The weighted raw total uses fixed editorial anchors: 18 raw points maps to the
low end of the scale, 81 to the high end. Final score is
`round((raw - 18) / 63 * 100)`, clamped to 1–100. They are set so the median
card on record reads as an average night at 50 (two and a half stars), the best
cards ever run reach the top of the scale, and the notorious duds sit near the
bottom: across the archive that puts 52 cards at one star, 308 at two, 330 at
three, 90 at four and 6 at five. The anchors were read once off
the raw spread of the whole archive and then frozen as constants, so adding a
new event never restates an old card's score. They are versioned design
choices, not fitted win probabilities.

## Expected versus delivered

Every review also carries `expected`: the same card scored on the preview
basis, from pre-fight evidence alone, with its lineup already final. The star
tooltip reads both — "Expected 73/100 from the lineup; the fights added 12" —
so a rating that moved after the event says what moved it. The two numbers are
kept separately: a review never overwrites the expectation it started from, and
the expectation is a property of the lineup, unaffected by the results.

Because archived rankings do not exist, `expected` is computed with the ranked
factor absent for consistency with the review beside it. It is a retrospective
reading of the pre-fight evidence, not a copy of the estimate that was shown
before the event.

## Calibration

`card-quality.test.ts` asserts the model's direction and its spread rather than
individual scores: each extra finish must raise a review, a knockout must beat
a submission at every count, a submission must beat a decision, more ranked
fighters must raise an estimate, the same knockout must be worth more in the
main event than on the prelims, a card must not be rated before it has six
bouts, and the reviewed archive must stay spread across the scale (worst ≤ 25,
best ≥ 85, median between 30 and 60). A Fight of the Night decision must beat a
quiet one and still lose to a finish, a reigning champion must raise what is at
stake, and the men's-divisions preference must be visible and proportional.
Rankings are asserted to have no effect on any review.

The weights above were set by reading the whole archive rather than one card:
recognizable cards land where a reader would expect them (UFC 217, 269, 261,
205 in the nineties; UFC 149 and the flattest Fight Nights in the teens), and
the reviewed archive runs from 12 to 99 with a median of 49 and nothing pinned
to either end of the scale.

## Presentation and refresh

Stars use Lucide React and render to the nearest quarter star (five score
points); the title tooltip preserves the exact integer score. Five full stars
correspond to 100 points. A card with no rating renders no stars at all.

Historical fighter inputs come from the state entering each bout. Today's
rankings and later career achievements are never projected into completed
cards. Rankings are canonical Meta for upcoming scores so changing page
preferences does not give the same card different ratings. Belt vacancy
dates remain limited by the existing lineage data.

Membership, date, result, title status, bonus and both price columns are read
on each score request. Their content hash, current rankings and the fight
index version key the shared aggregate cache. Additions, removals and price
corrections invalidate it even when row counts or timestamps stay the same.
Open event listings and upcoming cards refresh every 30 seconds; completed
detail cards refresh every five minutes. Updates reflect locally synced data,
not changes at an external source before the existing sync has fetched them.
