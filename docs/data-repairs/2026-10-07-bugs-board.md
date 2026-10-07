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
- Community aggregates must cover the rounds actually scored, with consistent
  vote counts and totals. Invalid samples are rejected; an admin check exposes
  existing invalid cards and offers re-reading when their event is linked. This
  catches scheduled five-round samples on three-round technical decisions.
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
It is retained as `/data/backups/backlog-2026-10-07-preapply.db`.

Each patched fight must still match its event, date, fighter IDs, names, outcomes,
method and round. Each field is updated only if the current value matches the
original backup. Changed live values are skipped. The transaction validates
scorecards against current official totals, community ranges and provenance,
and checks SQLite integrity before commit. Replaying the patch a second time
must make no changes.

The board's grades and count limits are unchanged. Some checks display at most
1,000 items, so their headline count only falls once the actual backlog drops
below that limit.

## Live development measurements

Measured at 22:07 UTC, against the initial dev snapshot. This includes the
scorecard/profile recovery merged in #131 during this pass; its newer live data
was preserved rather than replaced. The first apply added 321 fields across
317 fights, linked 647 Verdict cards, and skipped 5,966 changed live fields.

| Check | Initial dev snapshot | Live dev |
| --- | ---: | ---: |
| Official cards missing round scores | 3,564 | 637 |
| Missing community cards | 6,348 | 2,307 |
| Replacement notice/announcement gaps | 999 | 819 |
| Unknown roster timeline boundaries | 3,245 | 3,084 |
| Not bad badge | 4,402 | 4,063 |
| OK badge | 2,373 | 2,001 |
| All open check items, before display caps | 14,693 | 7,377 |

Four existing inconsistent community cards are now visible. The Must count
remains six: two suspicious odds movements and four unverified career records.
The remaining source scan can add further validated fields; rejected samples
are excluded from the patch.

## Verification

- All 466 server tests passed on a separate archive copy, including source
  parsing, complementary panels, refresh preservation, invalid community
  scores, board repair targets and guarded actions.
- Server TypeScript, 139 client tests, client lint and the production client
  build passed. Client npm audit reports zero vulnerabilities.
- Patch replay passed on a fresh original copy; a second apply changed nothing.
  A deliberately changed field remained untouched and counted as a conflict.
- The live transaction and its preceding backup passed SQLite integrity checks;
  the deployed dev container is healthy. GitHub PR checks passed.

Remaining gaps require further dated or independently verifiable evidence;
unsourced historical dates, missing community votes, extreme odds and unverified
career records are retained.
