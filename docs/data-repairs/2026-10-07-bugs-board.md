# Bugs board recovery — October 7, 2026

This pass uses a consistent backup of the development archive. Tests, source
imports and patch replay use separate private copies. Archive contents and
credentials are not committed.

## Fixes

- Verdict and MMA Decisions importers combine complementary judge panels and
  read the current stored panel after fetching the source. Re-reading a partial
  or empty page preserves previously validated cards. Round numbers must be
  contiguous, scores valid integers, and sums equal the stated totals. Without
  independent official totals, a complete panel needs three distinct judges.
- Known Verdict event associations give both scorecard gap checks a working
  re-read action. Roster actions accept the two sources the board actually offers.
- Replacement citations must explicitly name both fighters in the correct
  direction, provide a public URL and a valid full publication date, and identify
  one actual card replacement. The UI says **announced N days before**, preserving
  the distinction between publication and acceptance. Existing exact notice wins.
- Historical roster import recognizes the old “Recently released” heading.
  Release requests, conditional retirements and incomplete dates are excluded.
- Biography reports add explicit dated UFC signings and departures only when
  one fighter identity and the bout timeline support them and they resolve an
  existing unknown boundary. Event bookings, former UFC veterans retiring in
  another promotion, speculative reports and forum links are excluded.
- The client lockfile updates source-map-js to its patched 1.2.2 release.

## Repair procedure

The development backup is retained under
`/data/backups/backlog-2026-10-07-before.db`. Importers run on the isolated copy;
only changed scorecard fields, sourced announcement text and verified Verdict
event associations are transferred. A second backup precedes the live apply.

Each patched fight must still match its event, date, fighter IDs, names, outcomes,
method and round. Each field is updated only if the current value matches the
original backup. Changed live values are skipped. The transaction validates
scorecards against current official totals, community ranges and provenance,
and checks SQLite integrity before commit. Replaying the patch a second time
must make no changes.

The board's grades and count limits are unchanged. Some checks display at most
1,000 items, so their headline count only falls once the actual backlog drops
below that limit. Final live measurements and verification are recorded after
the source pass finishes.

Remaining gaps require further dated or independently verifiable evidence;
unsourced historical dates, missing community votes, extreme odds and unverified
career records are retained.
