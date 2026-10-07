# Scorecard and birth-date recovery — October 7, 2026

Measured on separate, checked copies of the production and dev archives. No
unknown scores, judge identities or dates were invented.

| Production check | Before | After |
| --- | ---: | ---: |
| Official panels missing round scores | 638 | 637 |
| Scorecards with an unnamed judge | 42 | 32 |
| Active fighters with profile gaps | 7 | 6 |

- Seven unnamed panels already had a complete named source panel agreeing with
  all three UFCStats totals. The shared merge now recovers those names, reserves
  named officials before assigning anonymous cards, and prefers named source
  rounds over earlier anonymous imports. This also fixes the judges' profiles.
- Re-reading the six previously matched MMA Decisions sources recovered three
  additional panels. The Bugs board offers **Recover judge names** for these
  stored source links, under the existing backup, serialization and audit guard.
- A full MMA Decisions pass checked 582 decision pages from 239 matching cards,
  filled the Natalia Silva–Wang Cong panel, and reported no fetch failures.
  The importer also retains published names/totals when round scores are absent;
  those cards continue to count as missing rounds.
- Source-only official scorecards now appear in the officials' directory and
  judge profiles, consistently with the matchup's scorecard panel.
- Verified career histories can fill a missing birth date. Existing dates are
  retained, impossible dates rejected, and an empty UFCStats birth-date response
  cannot erase the fallback. Anthony Romero's verified history fills his gap.

## Restore dev's missing scorecards

Dev lacked thousands of source-backed panels that were already in production.
`server/src/import-scorecard-archive.ts` audits by default and only applies with
`--apply`, after an online SQLite backup passes its integrity check. It copies
only scorecard fields, verifies the same bout id, date, fighter order, method and
round count, checks complete round samples and independent official totals,
preserves source links, and leaves complete existing cards in place. It rejects
incompatible or incomplete samples and never copies account data.

On the isolated dev copy, 2,924 official imports and 4,025 community imports
were restored. Missing official round panels fell from 3,564 to 640 and missing
community cards from 6,348 to 2,323. The remaining mismatches stay visible.

Run the audited import against explicit source and target archive paths:

```sh
node src/import-scorecard-archive.ts /private/source.db /data/ufc.db
node src/import-scorecard-archive.ts /private/source.db /data/ufc.db --apply
```

To re-check only the previously matched sources for unnamed judges:

```sh
node src/repair-judge-names.ts
node src/repair-judge-names.ts --apply
```

The latter also takes a checked backup before applying changes.

Regression checks cover rejected identities and scores, anonymous panels,
read-only audits, repeat imports, preservation of existing cards, source-only
judge profiles, verified birth dates, and guarded admin repairs.

## Validate community averages consistently

An audit found 75 stored production community aggregates whose round coverage
was incompatible with the bout's completed rounds. The scoring store previously
filtered out extra rounds but kept their full-bout totals, so a five-round
average could be weighted into a three-round bout. Officials also accepted
these averages without checking round coverage.

A shared validator now checks the positive integer sample count, exact
consecutive round coverage, bounded finite averages and consistency between
totals and round means (allowing independently rounded published figures).
Fight scoring, officials, career decision scores and both importers use it.
Invalid stored aggregates stay available for investigation and appear in an
admin Bugs category with a guarded source-card repair action. Missing-mode
imports can recover them; an incompatible source refresh cannot overwrite a
valid community aggregate.

Regression checks exercise extra, missing and duplicate rounds, contradictory
totals, preservation of genuine user cards, source refresh rejection, judge
agreement exclusion and the repair action.
