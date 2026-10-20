# MMA Decisions decisions marked read without being read — October 20, 2026

MMA Decisions answers production's address with 403 (Apache, any user agent);
the same pages load from other hosts. The hourly pass (`syncRecentPointDeductions`)
still marked every decision it was given as checked, so in two hours 430 of
4,140 decisions were recorded as read with nothing stored. None had a deduction
or media card stored in production.

- #239 stopped new damage: `crawlMmaDecisions` reports a bout checked only when
  every archive, event and decision read that could hide it succeeded, and a pass
  with failed reads is recorded as a sync error (Admin → Errors).
- Migration `migration_unread_mma_decisions` clears `deductions_checked_at` on
  decisions with neither deductions nor media scores stored, so those stamped
  before #239 are read again once the site answers. It does not move the data
  revisions.

Admin → Bugs "Decisions not yet read from MMA Decisions" now counts every
decision in production, which is the true state until the block is lifted.
