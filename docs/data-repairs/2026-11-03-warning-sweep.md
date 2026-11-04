# Production data warning repair review

Reviewed November 3, 2026, in `bug/data-quality-sweep`. The production board
started at 0 critical, 1 must-fix, 351 minor and 7,377 OK entries. Production
code was not deployed.

## Same-archive comparison

The audit used a SQLite backup of the VPS development archive, isolated from
both previews and production. The reference implementation was the task's
base commit, d5887c7. The final report uses the baseline report's audit time
so source-freshness thresholds cannot create apparent gains or regressions.
Only public source evidence was replayed; private archive files remain ignored.

| Check | Before | After | Minor entries removed |
| --- | ---: | ---: | ---: |
| Unlinked anti-doping records | 138 | 84 | 54 |
| Missing anti-doping fighter-years | 102 | 70 | 13 |
| Replacement announcement/notice gaps | 541 | 506 | 34 |
| Unnamed replacements | 51 | 49 | 1 |
| Replaced fighters without a profile | 20 | 17 | 3 |
| Cards with unread pay evidence | 70 | 44 | 2 |
| Fighter pay unknown | 627 | 624 | 0 |
| Unsupported point deduction records | 4 | 1 | 3 |
| Current roster source gaps | 19 | 18 | 1 |

Across the complete report, total entries fell from **7,831 to 7,672**
(**159 removed**), and minor entries from **360 to 249** (**111 removed**).
Critical and must-fix totals were unchanged. The development archive differs
from production; these are measured development results, not a claim that
the live counter has already fallen.

Production additionally has one false deduction warning for symbolic
Couture–Smith whole-bout votes, covered by a regression test. Its five
deduction warnings should become one after release. No severity rules,
review flags or warning filters were changed.

## Source and data safeguards

- [Anti-doping evidence](../antidoping.md): 27 registered-name aliases;
  test counts unchanged and ambiguous same-year identities left unlinked.
- Replacement source URLs and publication dates are retained in
  `server/src/replacement-reports.json`. Announcement dates are labelled
  separately from explicitly stated acceptance notice. Newly reviewed
  identities and notices repair existing replacement slots without a new
  article revision; an unflagged corner is not turned into a replacement.
- The profile lookup falls back to a uniquely confirmed signee when duplicate
  UFCStats directory entries have no bout evidence. It does not merge them.
- Wikipedia's Nepal flag codes NEP/NPL now resolve to NP.
- [Pay and crew evidence](2026-11-03-pay-and-crew.md): replaying 26 affected
  articles resolved 27 unread bonus rows. Existing purse values and source
  conflicts were preserved. Failed salary reads or missing/wrong-date
  Wikipedia responses now preserve stored pay and queue a retry.
- [Deduction evidence](2026-11-03-point-deductions.md): three guarded,
  source-backed repairs; symbolic result votes retained without invented
  numeric rounds, including in judge statistics.

The must-fix crew report names five roles but literally leaves the desk host
as “XX”. Those five roles are available; the host remains unknown. A later
complete source read takes precedence over the partial reviewed record.
The Swick–Davis scorecards contradict their source's deduction round and remain
flagged. No penalty was moved to make the numbers fit.

## Propagation

Anti-doping links and guarded deductions repair at startup. Replacement
evidence applies on the normal sync pass. Profile links resolve at read time.
Roster flags refresh with the next roster read. A parser/alias fingerprint
queues existing pay-issue cards once for the ordinary bounded background
reader; failed sources keep their previous data and remain queued.


## Verification

- Server TypeScript check passed.
- Client TypeScript and production build passed.
- The full server run exercised 822 tests: 820 passed, with one failing HTTP
  assertion (and its parent test) because this new worktree had no client
  build. After building the client, the complete HTTP security test passed
  all five checks. Previously passed checks were reused.
- Scoped source/parser, replacement, anti-doping, crew, pay preservation,
  deduction repair and judge-statistics regressions passed.
- Read-only agent review found and fixed missing-source preservation,
  explicit retry queueing, and the imported-symbolic-vote statistics path.
- `git diff --check` passed.

The Tailscale preview is seeded from the isolated, repaired development
archive. Tests never wrote to preview, shared development, or production data.

