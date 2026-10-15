# Production data recovery — October 15, 2026

The baseline is a verified online backup of production taken at 02:53 UTC.
Research, source downloads, imports and tests use private archive copies.
No credentials, databases or downloaded articles are committed.

## Retained evidence and corrected readers

- Biography contract reports immediately following headings, later in a
  paragraph, or with the date following the contract statement are now read.
  Only the biography's own subject can be expanded from a surname or pronoun.
  Fight dates followed by undated departures, conditional retirements and
  another promotion's reports are rejected. Replaying 1,323 biographies retains
  47 additional dated signing/departure reports.
- Explicit Contender Series contract awards are read separately from fight
  results. Eleven additional awards match both the fighter's recorded series
  appearance on that date and a subsequent UFC career, and resolve an actual
  timeline gap. Developmental deals, later call-ups and unsigned participants
  are excluded. Original result reports and Wikipedia revision ids are retained.
- 119 additional replacement reports were reviewed against their original
  articles. Publication metadata supplies the announcement date, never an
  acceptance date. The retained reports complete unnamed replacements and
  correct immediate replacement identities, including Jennifer Gonzalez for
  Ramona Pascual and TJ Laramie for Bruno Souza and Luke Sanders. A corrected
  identity can expose a genuine missing profile; it is not linked to a namesake.
- Event titles are excluded from person matching. A title mentioning Rodriguez
  or Nogueira cannot make the wrong fighter a replacement. Four confirmed
  incorrect associations are explicitly rejected, exposed by a repairable Bugs
  check, and removed by the guarded replay. These are Christian Rodriguez /
  Drakkar Klose, Rogerio Nogueira / Alexander Gustafsson, Montana De La Rosa /
  Macy Chiasson, and Rony Jason / John Hathaway. Each retains its original report.
- William Knight's 218 lb miss at UFC 271 remains stored. UFC's own result report
  confirms that the light heavyweight bout moved to heavyweight after the miss;
  the diagnostic now uses the original division's limit.

## Guarded replay

`repair-event-changes.ts` remains an audit unless passed `--apply`. Applying
takes an integrity-checked online backup. Event and bout identity, replacement,
notice and short-notice fields are rechecked inside a short transaction. Changed
live fields are skipped. Only the explicitly verified incorrect associations
can be removed; an empty source parse never clears an arbitrary stored value.
Existing exact notice is preserved when adding missing announcements.

The private replay changes 114 bouts: 110 missing announcements and 15 identity
fields, including four removals. A second replay changes nothing.

The MMA Decisions pass reads 31 yearly indexes, 274 matching events and 654
decision pages without fetch failures; it finds no additional official panels.
Verdict's 1,607 linked events are reread without fetch or import failures. This
recovers three distinct valid community cards; repeat writes to split event
pages are counted only once. Only scorecards accepted by
`import-scorecard-archive.ts` are eligible for production transfer: exact bout
identity and date, complete rounds, valid totals/vote counts, and source
provenance. Valid existing cards are preserved; timestamps are not transferred.

## Diagnostic comparison on the private replay

| Check | Production baseline | Repaired copy |
| --- | ---: | ---: |
| Roster timeline evidence gaps | 3,080 | 3,022 |
| Replacement announcement/notice gaps | 701 | 591 |
| Unnamed replacements | 98 | 92 |
| Confirmed incorrect replacement associations | 4 | 0 |
| Weight misses at/below the relevant limit | 1 | 0 |
| Replaced fighters without a UFC profile | 18 | 19 |
| Missing community scorecards | 2,214 | 2,211 |
| Not bad | 3,930 | 3,756 |
| OK | 3,215 | 3,212 |

Source freshness ages naturally on an isolated snapshot with sync disabled;
those stale-source warnings are not production regressions. Diagnostic grades,
item limits and coverage requirements are preserved.

## Verification

- All 531 server tests pass against a separate private archive copy.
- All 145 client tests, server TypeScript, client lint and production build pass.
- GitHub PR checks pass at the exact reviewed head.
- A second rehearsal starts from a fresh production backup and repeats all
  114 bout repairs without conflicts. The scorecard transfer adds three cards;
  repeating both tools changes nothing. The repaired fresh copy reports 3,756
  Not bad, 3,212 OK and no Must or confirmed replacement identity conflicts.
- Regression cases cover unrelated headliners, wrong fighter identities,
  incomplete/conditional contract evidence, wrong event dates, unchanged exact
  notice, changed live fields, safe removals and idempotent replay.
