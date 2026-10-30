# Fighter pay

The fight page separates commission-disclosed purses, reported post-fight
bonuses and estimated fight-week compliance pay. The displayed total is only
the disclosed purse plus known bonuses; it excludes compliance pay, PPV,
sponsorships, discretionary bonuses, taxes and expenses. Unknown amounts stay
unknown. The question mark opens the category's explanation and this bout's
evidence in the shared mobile bottom sheet / desktop dialog. All four
categories are available as tabs, including categories without an amount.

`server/src/fight-pay.ts` assembles each card. Wikipedia's event payout section
is read first, then reviewed historical reports, then all matching MMA Payout
salary posts.
The first supported figure stays when sources disagree; the alternative and
both source links are retained, and Admin → Bugs lists the conflict. Never add
an ambiguous winner's base salary to an assumed win bonus. Show/win parts are
kept only when stated; a weight fine can make their sum differ from the reported
total. A disclosed purse is not the fighter's total earnings.

## Reviewed historical disclosures

`server/src/purse-reports-data.ts` contains public facts from 28 cards,
2006–2009: 511 supported fighter purses in 261 bouts. It supplements event
articles; it does not require Wayback access during background sync. Every row
must match the date, UFCStats bout ID and both names, in corner order. A row
that stops matching goes to **Pay rows not read**. The usual per-card re-read
action reapplies the reviewed facts alongside the live sources.

On the October 28, 2026 private archive copy, replaying the same 792 cached
event articles through `cardPay` increased coverage from 181 to 203 cards,
2,030 to 2,233 bouts, and 4,034 to 4,446 fighter purses. That is 412 additional
disclosed purses; other bundled figures overlap existing evidence.

Most records were extracted from archived MMA Junkie salary reports that say
they obtained the figures from an athletic commission. Each record includes
the original article and its exact Wayback capture. Only article bodies were
read; related stories, captions and ads were excluded. Quoted nicknames and
salary rows split before “def.” are handled. Weight-fine footnotes are kept,
including a trailing `+` mark. The bundle contains facts, not article bodies.

The October 30 expansion adds 52 purses in 26 bouts from UFC 63, 64 and 65.
Ivan Trembow's own copies of his MMA Weekly reports explicitly attribute the
figures to the commissions and say win bonuses are included:

- [UFC 63 and 64](http://www.ivansblog.com/2006/10/mixed-martial-arts-ufc-63-and-ufc-64.html):
  California and Nevada disclosures, totaling $332,000 and $209,000 respectively.
- [UFC 65](http://www.ivansblog.com/2006/11/mixed-martial-arts-ufc-65-fighter.html):
  California disclosure totaling $457,000. Independently checked against
  [MMA Mania's commission report](https://www.mmamania.com/2006/11/22/200576/ufc-65-payouts),
  including St-Pierre's $58,000 instead of an earlier $80,000 claim.

All three cards had no purses when their current Wikipedia articles were
replayed through `cardPay` without these reports. The bundle fills all 52
corners; every full-card sum agrees with the reporter's published payroll.
The reports do not state show/win splits, so those components remain unknown.
The reporter's site serves these articles over HTTP; its HTTPS endpoint was
unavailable during research. Earlier 2005 lists on that site are research
leads only: the inspected articles did not explicitly identify a commission
as their source, so they have not been imported as commission disclosures.

A fingerprint of the reviewed bundle queues its completed cards for another
read whenever the bundled facts change. The queue update preserves stored pay;
a failed Wikipedia request leaves the card queued. This also applies the older
bundle to cards already marked as checked before the bundle was added.

The earlier research covered 243 archived salary URLs. Only missing disclosures
with supported amounts were added. Important exclusions and independent checks:

- The [UFC 70 report](https://mmajunkie.usatoday.com/2007/04/ufcjunkiecom-quick-hits-ufc-70-salaries-ufc-on-the-boob-tube-fishman-lawsuit-and-more)
  says its figures could not be confirmed. They are not bundled.
- MMA Junkie's UFC 68 report says some figures were deliberately altered. Its
  list is not used. UFC 68 instead uses [MMA Mania's independently obtained
  Ohio commission disclosure](https://www.mmamania.com/2007/03/06/200614/ufc-68-fighter-paydays-and-salaries),
  also cross-checked against [MMA Weekly's disclosure](https://www.mmaweekly.com/news/ufc-68-fighter-salaries-2).
  The latter separately lists UFC Fight Night 8; its 16 salaries total $299,000
  and are bundled for that card only.
- The early MMA Junkie UFC 67 report says confirmation was pending. Bundled
  totals instead come from [MMA Weekly's commission disclosure](https://www.mmaweekly.com/news/ufc-67-fighter-salaries-2).
  Its Silva/Lutter weight-fine adjustments and two stated flat fees are kept;
  other show/win components are left unknown.
- Malformed figures such as Arlovski's `$145,0O0`, Bisping's `$24,0O0` at
  UFC 66, and Johnson's `$30,0000` at UFC 104 are not corrected by inference.
  The affected corners remain unknown unless another supported source fills
  them, and the unread row stays in Bugs with links to its report.

To extend the bundle, obtain the original commission disclosure or a report
that explicitly attributes its numbers to that commission. Review the full
article for corrections, qualifications, fines and bonus inclusion. Add only
its supported facts and exact source URLs. Use a saved archive copy when the
original is unavailable. Run the salary parser tests and archive-backed
`fight-pay.test.ts`; they check identity, provenance, source disagreements,
fine handling and unsupported amounts. Do not import generic earnings
estimates or unconfirmed international salary lists as disclosed purses.

## Estimates and gaps

Fight-week estimates use the Venum schedule from April 2021, documented by
[ESPN](https://www.espn.com/mma/story/_/id/31176357/ufc-new-venum-uniform-deal-gives-fighters-slight-pay-bump).
Inputs are the fighter's UFC bouts including this one, plus Zuffa-era WEC and
Strikeforce bouts from a verified career record. Title roles affect the tier;
vacant and interim title bouts are not estimated. Reebok-era bouts are not
estimated. These amounts always carry `~`, and their inputs are shown in the
Fight week tab. Reported purse/bonus totals never include these estimates.

Admin → Bugs → Missing data lists **Fighter pay unknown** and **Pay rows not
read**, with per-card re-read actions. Unsupported or absent historical
disclosures stay listed, even when their age makes them an expected gap. CSAC
and CombatReg are research leads for commission results, not purse evidence
by themselves.

The unknown-pay check retains historical cards under **OK**; that severity
means an expected research gap, not complete data. Recent cards and partial
disclosures are **Not bad**. Each item counts missing purses by fighter, so
partial repairs are visible even while the card has another gap. The top-level
board counts cards, not individual missing amounts. A card leaves this check
only when its missing purse, bonus and applicable fight-week fields are filled.
Reported bonuses without an amount are included even without a UFCStats award
flag, as are vacant-title bouts whose fight-week estimate is withheld.

## Finding more reliable records

Completed cards are read once and revisited daily for 180 days, rather than
60. Matching MMA Payout reports use the same publication window. Every
matching post contributes supported missing corners; a newer, partial post
cannot hide an older full list. Disagreements still retain the first amount
and appear in Bugs with the alternative and source links.

Prioritize original commission disclosures and reports that obtained the
records directly, then preserved copies from the original reporter. Recent
California, Washington, Georgia and Kentucky disclosures inspected in this
audit already had full coverage in their Wikipedia payout sections. For
jurisdictions that release records, public-records requests can uncover more:
[MMA Junkie's 2026 Seattle report](https://sports.yahoo.com/articles/ufc-seattle-salaries-israel-adesanya-193030673.html)
describes receiving the March 28 figures on May 19 after a records request.
No requests have been sent on the user's behalf.

Fighter statements and unsealed court documents are additional research
sources, but may describe total compensation rather than the commission purse.
They must not be inserted into the purse field without establishing exactly
which bout, amount and payment component they support. Public estimates,
previous-fight contracts, career earnings, and a fine percentage alone do
not establish a disclosed purse. Private PPV shares, side agreements and
discretionary bonuses can remain unknowable even when a purse is disclosed.
