# Source metadata repair — September 30, 2026

Verified against an isolated online backup of the development archive. No
production data was edited during development.

- Wrong-city venue entries: 11 → 0 after clearing contradicted source metadata.
  Valid Wikipedia venues remain; the scheduler re-reads missing source fields.
- Unverified recent career records: 25 → 5 after source retries. Three failing
  debutant/history regressions passed with the refreshed, verified records.
- Roster field errors: 91 → 0 after reading Wikipedia's Lua flag icons and
  forcing a re-read even when the article revision has not changed.
- Suspicious-price board entries: 42 → 2 after fighter-page source repairs.
  The final retry repaired 16 of 17 remaining inconsistent pairs. Chart results
  with incompatible corners are now rejected; remaining
  suspicious moves still appear on the Bugs board with a re-fetch action.

Startup applies the metadata cleanup once and queues inconsistent stored
moneylines for the existing sync worker. Old odds remain until a source read
supplies a consistent replacement. Unresolved identities stay unverified.
