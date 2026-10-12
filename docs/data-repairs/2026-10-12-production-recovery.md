# Production data recovery — October 12, 2026

The production baseline is an online SQLite backup, checked before use and
retained at `/data/backups/production-bugs-2026-10-12-before.db`. Research,
source imports, regression tests and replay use separate private copies.
Credentials, databases and downloaded articles are not committed.

## Corrected source reading

- Replacement headlines such as “Oliveira out; Volkanovski now faces
  Makhachev” explicitly announce a withdrawal and its new booking. Both
  fighters, the direction, a valid publication date and a public source are
  required. Speculative or reversed headlines do not supply dates.
- A surname is resolved against its latest announced pairing before an
  unrelated linked namesake. Jean Silva replaced **Gabriel Santos**, Terrence
  Mitchell replaced **Christian Rodriguez**, and Iasmin Lucindo replaced
  **Istela Nunes**. The earlier stored names were Yana Santos, Yair Rodríguez
  and Nina Nunes respectively.
- Six primary MMA Fighting reports explicitly name replacements in their
  bodies, despite less specific citation headlines. Publication metadata
  agrees with the retained dates. `replacement-announcements.ts` retains the
  exact event date, both identities and each source URL.
- Dated biography statements can name their own subject by surname, or say
  that the UFC released “him/her”. Different full names and later opponents
  are not substituted. Ten additional signing/departure reports resolve real
  gaps after checking the fighter's identity and professional timeline.

Replaying 575 retained event revisions accepts 544 and rejects 31 whose dates,
locations or card identities cannot be established exactly. It recovers 120
announcement dates and corrects three replacement identities. Existing stated
notice is preserved. Announcement dates remain labelled **announced N days
before**, never as an acceptance date.

## Guarded application

`repair-event-changes.ts` audits by default. It accepts a baseline database,
target database and a private cache of public article revisions. Each cache
file is named for its event id and retains `{ name, revision, text }`.

```sh
node src/repair-event-changes.ts BASELINE.db TARGET.db ARTICLE_CACHE
node src/repair-event-changes.ts BASELINE.db TARGET.db ARTICLE_CACHE --apply
```

Applying takes another online backup and verifies its integrity. Parsing stays
outside the write transaction. Inside the short transaction, event identities,
bout identities and original replacement/notice fields are checked again;
changed live fields are skipped. Corrected names clear their old profile id so
the normal identity resolver can link the correct person. SQLite integrity is
checked after commit. A second replay makes no changes.

Scorecards are recovered through the existing `import-scorecard-archive.ts`,
which independently checks fighter order, event date, method, completed rounds,
judge totals, community averages and source provenance. Complete current cards
are preserved. Separate Verdict and MMA Decisions passes operate on the private
copy; only validated scorecard fields are eligible for live import. Refresh
timestamps and user data are not transferred.

The board's grades, limits and checks remain intact. Unavailable historical
rounds, votes, roster dates, notices and profile measurements remain unresolved.

## Verification

- Full server suite: 502 tests passed against a separate archive copy.
- Client: 144 tests, lint and production build passed.
- Server TypeScript passed; 48 focused source/repair tests passed after the
  final parser and retained-report changes.
- Replay tests cover wrong cards, namesake identities, reversed announcements,
  invalid dates, changed live fields, exact-notice preservation and idempotence.
- A full MMA Decisions pass read 654 decision pages across 274 matching cards
  with no fetch failures; it found no further round panels.
