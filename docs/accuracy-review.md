# Accuracy and polish review — September 4, 2026

This review preserves the existing app and the edits already in progress.
It adds no new external dataset and does not rewrite source fight results.

## Changes

- Labs now displays five complementary insight cards: yearly win rates,
  population breakdowns, output given/taken, round patterns and market returns.
  Each has an exact-value table; breakdowns show their sample size and flag
  samples below 20 results. Trend charts keep gaps for missing calendar years.
- Missing grappling data stays unknown. Each paired action rate uses its own
  timed sample. Control shares use recorded-control fight time in Labs,
  historical matchup profiles and profile records.
- Market calibration removes the bookmaker margin per price pair and uses
  the same priced win/loss/draw sample for observed and implied rates.
  Probability filters compare unrounded values.
- Champion filters and matchup fills recognize belts held in any division.
  Other prior win/loss methods are no longer labelled as decisions.
  Reach/height bucket labels correctly describe fractional measurements.
- Exclusions update every dashboard panel from the same server result.
  Distinct fight/fighter counts cannot drift from the record. The bout list
  remains available when everything is excluded; manual filter changes start
  a fresh exclusion set. Up to 250 manual exclusions fit within request limits.
- Failed studies and bout requests report failure and offer retry. Delayed
  matchup fills cannot overwrite a manual filter change or reset. Search
  requests are cancelled when superseded or closed.
- Pages load their JavaScript on demand. Shared API requests are deduplicated
  and the cache retains at most 80 inactive/active response entries in normal
  use (active subscriptions and pending requests are protected from eviction).
- Stats has unobtrusive comparison bars and a toolbar that wraps on phones.
  Mobile Labs puts filters first and bounds its bout scroller. Theme tokens,
  keyboard focus, timeline navigation and reduced-motion behavior are shared.

## Verification

- 90 server tests, including independent SQL/index checks and incomplete-data
  regression fixtures; 5 client request-cache tests.
- Client production build, client lint and server TypeScript check pass.
- Stored-stat audit: 8,858 completed fights, all detail pages cached;
  8,837 with parsed official totals. No detected summary, target, position,
  total/significant or round-sum inconsistencies. The remaining 21 are not
  certified by the official-totals portion of this audit.
- Browser checks cover desktop/mobile layouts, theme switching, navigation,
  filtered totals against the API, exact tables, round/breakdown controls,
  request failure/retry and excluding/restoring an entire population.
- Warm local HTTP medians over five requests: full Labs 16.1 ms, filtered
  Labs 4.4 ms, Stats 42.9 ms. These are local measurements, not deployment SLAs.
- Initial application JavaScript: approximately 199 KB before compression,
  versus 437 KB before this review. Additional page chunks load when needed;
  this is an initial-download reduction, not a reduction in total app code.

## Limits to a claim of 100% accuracy

Passing internal consistency checks does not independently certify every
third-party source fact. The app still depends on source completeness and
refreshes. Belt lineage is reconstructed from fight results and does not date
vacancies; listed stances and measurements are not historical snapshots. Labs
now explains these limitations alongside the relevant filters.

The next accuracy investment should be dated, sourced belt-vacancy events and
field-level provenance/coverage. Additional predictive features or outside
datasets should wait until their identity matching, definitions and source
coverage can be tested as rigorously as the existing fight records.
