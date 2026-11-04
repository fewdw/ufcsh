# Reviewed deduction gaps and symbolic historical votes

The five production items were checked on November 3, 2026. This repair adds
three explicit source records and stops treating whole-bout votes as numeric
round scores. No penalty is inferred from a 9-9 round.

## Supported deductions

- Cameron Saaiman vs Mana Martinez, UFC 285, March 4, 2023: the
  [Nevada commission results, page 2](https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2023_Results/03-04-23MMA_Redacted.pdf)
  explicitly records a one-point deduction from Saaiman in round 1 for low
  blows. Its three final totals also agree with the stored official cards.
  MMA Decisions page 13811 lists no deduction; that exact empty source record
  is the only populated record this fallback will replace.
- Leonardo Santos vs Norman Parke, March 23, 2014: the
  [UFC report](https://www.ufc.com.br/news/this-day-ufc-history-henderson-vs-rua-2?language_content_entity=en)
  explicitly identifies a one-point deduction from Parke in round 2 for
  grabbing Santos shorts. The recorded 28-28, 28-28, 29-27 results agree.
  The local archive had no stored deduction record.
- Elias Silverio vs Isaac Vallie-Flagg, January 15, 2014:
  [MMA Decisions page 4816](https://mmadecisions.com/decision/4816/Elias-Silverio-vs-Isaac-Vallie-Flagg)
  explicitly records one point from Silverio in round 2 for an illegal knee
  to a downed opponent. All three cards are 29-27, with round 2 scored 9-9.
  The local archive had no stored deduction record.

`verified-point-deductions.ts` checks each exact bout ID, date and ordered
fighter names. The correction requires all three complete round cards and
validates the stated penalty against every judge. Existing nonempty records,
unrelated source-confirmed zeroes, changed identities, missing round cards,
and contradictory rounds are left untouched. Applying the repair twice makes
no further changes. Ordinary MMA Decisions rereads reapply the guarded fallback
only while the source still has the exact reviewed empty record; a later
nonempty source record is preserved.

## Whole-bout votes

[Randy Couture vs Maurice Smith, MMA Decisions page 169](https://mmadecisions.com/decision/169/Randy-Couture-vs-Maurice-Smith)
has an explicit legend explaining that 1-0 means a judge favored one fighter
while the numeric score is unknown or not applicable, and 1-1 means a draw
under the same limitation. These are symbolic whole-bout votes, not ten-point
rounds or evidence of a nine-point penalty.

The round validator and public panel now retain those result totals while
removing a matching single symbolic round. Such votes cannot count as complete
numeric round data or enter scoring averages as ten-point rounds. Genuine 9-9
rounds and other ordinary numeric cards remain unchanged.

## Unresolved source contradiction

[Mike Swick vs Marcus Davis, MMA Decisions page 1018](https://mmadecisions.com/decision/1018/Mike-Swick-vs-Marcus-Davis)
lists a one-point fence-grab deduction in round 3 but all three judges have a
9-9 first round and 10-9 third round. The
[contemporary Yahoo report](https://sports.yahoo.com/ki-ufclive060708.html)
also places the penalty in round 3. Both rounds and final totals are imported
as published. Without the original official scorecards, changing the location
of the low round would infer individual judges scores. This item remains
visible for a source correction; the deduction is not moved to fit the table.

## Verification

`DATA_DIR=<private development archive> ./tools/heavy.sh node --test --test-concurrency=1 server/src/judge-scorecards.test.ts server/src/point-deduction-rules.test.ts server/src/verified-point-deductions.test.ts`

All 20 focused rule and repair tests passed. The new archive-backed cases verify exact identities,
independent final totals, every round, idempotence, source provenance and
preservation of future contradictory evidence. The historical vote regression
checks that the decision remains majority while numeric round coverage remains
incomplete. No production database was edited.
