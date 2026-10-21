# Bugs board, errors and slow requests — October 21, 2026

Read from a fresh online backup of production (18:18 UTC) and production's
error and slow logs. No critical or must items; every open check was minor.

## Fixes

- **Doctor's stoppages** (19 of 21 "Finishes without how they ended"): UFCStats
  prints no detail line for most, but its method says "TKO - Doctor's
  Stoppage". The profile shows "Doctor's Stoppage" when there is no line, and
  the check no longer lists them. Left: one DQ and one 1995 submission.
- **Media cards on a shared surname** (both "Media scores missing or dropped"):
  MMA Decisions names the winner by surname. "Silva" fit both Karine Silva and
  Ariane da Silva, "Scott" both Brad Scott and Scott Askham, so 17 cards were
  dropped. A name fitting both is now the fighter whose whole surname it is
  (deductions use the same rule). MMA Decisions refuses production and now the
  home server too (HTTP 403), so migration `migration_media_shared_surnames`
  places the stored dropped cards again; the page's fighter order is read from
  its address and must name both fighters exactly. It changes those two bouts.
- **Unrecorded early stats** (21 "Career statistics missing samples", 1994–98):
  UFCStats prints "--" in every column of the card row, so there is nothing to
  fetch. Graded OK.
- **Replaced fighters who never fought in the UFC** (11 of 19): UFCStats lists
  them under that exact name with no UFC bout. Graded OK. Left: names with no
  UFCStats profile, and two names held by duplicate profiles.
- **Replacements without whom they replaced** (41 of 92, articles read again
  on dev-pc): "X was expected to face Y, but pulled out and was replaced by Z"
  now counts the booking in the same sentence; "Y instead faced Z" after "X was
  expected to face Y … X withdrew" names X; "Featherweights Choi Doo-ho"
  completes "Choi". Every new name was checked against its article. Migration
  `migration_bout_changes` v5 reads the affected cards again.
- A test assumed no MMA Decisions refusal in the archive; it clears it first.

## Not changed

- **Decisions not yet read from MMA Decisions** (176): refused at the source.
- **Replacement notice** (553) and **roster timeline** (2,983): research
  backlogs. A notice needs a dated citation naming both fighters.
- **Point deductions that can't be shown** (5), **profile gaps** (5) and UFC
  193's FightOdds.io board (their API errors): the sources lack the data.
- Errors: no sync errors since the October 20 release; 404s from site links
  (old venue names, removed bouts, old asset hashes) already resolve or are
  stale tabs; 5xx were headshots ufc.com refused.
