# Project map

Where things live, so a change starts in the right file. One Node server
(`server/`) serves the API, the built client and share images; one Vite/React
client (`client/`) renders every page.

## Server (`server/src`, Node 26, TypeScript run natively)

| Area | Files |
| --- | --- |
| HTTP entry, routing, caching, images | `api.ts` (routes, `resolvePublicApi`), `api-policy.ts` (what is public, cache lifetimes), `response-cache.ts`, `query-pool.ts` + `query-worker.ts` (heavy reads off the main thread) |
| Page metadata, sitemap, 404s | `seo.ts` |
| Link-preview images (`/og/*.jpg`) | `og-images.ts` (drawing); data lookup in `api.ts` (`shareCardData`) |
| Fighter identity, records, photo URLs | `fighter-identity.ts` |
| Search aliases (GSP, Aljo, real and maiden names; search only, never shown) | `search-aliases.ts` |
| Career averages and opponent evidence | `career-metrics.ts` (shared formulas and recorded samples), `career-statistics.ts` (current career or cutoff before a matchup), `division-medians.ts` (each rate's division median over fighters with 3+ UFC bouts there in the 3 years before a date; ticks on the matchup bars and profile, `components/DivisionMedian.tsx`), `opposition.ts` (each UFC opponent's records then or now, standing tag and earlier or all fights), `fight-insights.ts` (bouts by round, average significant strikes landed and absorbed by round, average decision score by bout length over judges' cards and fan averages, wins against no-vig closing odds); missing samples in Admin → Bugs |
| Live Polymarket odds (header pill: each side's price for the bout on now, the result and bout number held 3 minutes after, or until the next bout starts) | `polymarket.ts` (Gamma markets matched by date and both names, CLOB order books, Polymarket's midpoint/last-trade rule; one shared answer every 2s on the main thread, never in query workers; state in `meta`), route `/api/live/odds` in `api.ts` (`?fight=` prices any bout on dev sites); fight-week scan every 30 min, unmatched bouts in Admin → Bugs; client `liveOdds.ts` (own feed: no persisted or stale prices), `components/LiveMatchup.tsx`, dev-only Live preview panel `livePreview.tsx` (profile → Live preview) |
| Cancelled bouts (a profile's Fights list, behind its Cancelled switch, off by default) | `cancelled-bouts.ts` (FightOdds.io's boards keep every booking that fell through, flagged on the card it was booked for, both corners linked by UFCStats id, since October 2013; the division checked against each corner's own (`bookedDivision`); board list daily, each coming card every 6 hours, each past card once after it's over; reason from the event article's `cancelled_json`; "Moved" with a link when the pair fought or are booked within a year after); `cancelledOnBoard` in `scrape/fightodds.ts`; unread boards, cards without a board and unlinked corners in Admin → Bugs. The event page's own cancelled list is Wikipedia's (`syncEventWikiInfo`) |
| Card running order (main card, prelims, early; ufc.com's place within each) | `card-schedule.ts` (`cardOrder`; `fights.ord` is UFCStats' list, which appends late additions to the bottom, so never order a card by it alone), `card_pos` read in `sync.ts` (`syncEventSegments`) from ufc.com's live-card feed (`parseFeedSegments`; it places late additions days before the cached event page does), else the event page; fight week re-read every 10 minutes, later cards every 30; unplaced bouts in Admin → Bugs |
| In-memory analytics index | `fight-index.ts` (every completed bout, state entering it) |
| Leaderboards | `stats.ts` (fighter cards), `stats-fights.ts` (Fights card: bouts, judges, referees) |
| Potential matchups (pinned unconfirmed odds board, separate from scheduled fights) | `potential-matchups.ts`; synced at startup and every five minutes from FightOdds.io and BestFightOdds future boards; `scrape/potential-odds.ts` reads BestFightOdds |
| Event YouTube media and broadcast crew | `event-media.ts` (read, discovery/backfill, coverage rules and explicit broadcast-report import), `scrape/event-media.ts` (channel identity, event matching, chronology and categories), `event-media-data.ts` / `event-broadcast-data.ts` (reviewed starter data); `/api/events/:id/media`; client `components/EventMedia.tsx` below the card in `pages/EventsPage.tsx`. Missing coverage, unread sources and unavailable videos in Admin → Bugs, with a re-read action. See `docs/event-media.md` |
| News (outlets, relevance, fighter/event tags, story grouping, newest first, `?fighter=` for one fighter) | `news.ts`; feeds read in `scrape/news.ts` (`NEWS_FEEDS`) |
| News read by Gemini (off by default; enabled in Admin → Settings; `GEMINI_API_KEY`) | `news-ai.ts`, run from the API process every 10 minutes |
| Profile records and full stat rankings | `records.ts` (`fighterRecords`, `fighterBoard`, `milestonesWithinReach`) |
| Ranking history (every official list since Feb 2013; ranks entering past bouts, profile chart) | `ranking-history.ts` (archive + Wayback backfill, snapshots from the rankings sync, confirmed undisputed title results shown from fight day without altering official lists); `ranking-archive.ts` (compact division archives preloaded for full chart tooltips); chart `client/src/components/RankingHistory.tsx`; missing history and title evidence in Admin → Bugs |
| Judges and referees | `officials.ts` (name merging, profiles, directory, search) |
| Judging analysis: the stats card (shown as the "stats judge"), controversy, judges' scoring tendencies, home fighters | `judging.ts` (stats card = logistic model of every judged round's numbers; controversial = 30+ fan cards and fans under 0.5 apart, fans had the other winner, or fans' rounds against their total; "How they score" from tiebreak rounds against the other judges on the same rounds; home record by venue country with favourite/underdog counts and expected wins from closing odds; Comebacks = a KO/TKO or submission loss after winning 2+ completed fan rounds and leading on points, ordered by rounds won then points lead); per-round strikes and control (`numbersOf`) on every scorecard; served at `/api/controversial` (widest first, `view=comebacks` for finishes with title and scheduled-round filters), added to `/api/judges/:slug`, matchups (`judging`), event fights (`controversy`) and location pages (`home`); Stats → Fights boards in `stats-fights.ts`; decisions without round stats in Admin → Bugs |
| Point deductions (scorecards and automatic fan-card corrections) | `point-deductions.ts` (MMA Decisions sync; recent decisions checked hourly, each at most every 6 hours for 45 days, history by `backfill-point-deductions.ts`); `point-deduction-rules.ts` (verified penalties replace provisional user entries, including confirmed zeroes; never inferred from a 10-8); `community-scorecards.ts` adjusts raw Verdict averages before scoring/analytics use them; `scoring.ts` applies the same rules to local totals and profiles. Unreadable/conflicting records and unexplained low rounds in Admin → Bugs with a re-read action. Client `Scorecards` in `components/FightStats.tsx`, editor in `components/ScoreEditor.tsx`; see `docs/scoring.md` |
| Media scores (journalists' cards on a decision) | Read from the same MMA Decisions page as point deductions (`parseMmaMedia` in `scrape/mmadecisions.ts`; `pageMedia`/`storedMedia` in `point-deductions.ts`, a card must agree with its own stated winner), stored in `fights.media_scores_json`, sent as `detail.media`; a column after the fans (their average) in `Scorecards` (`components/FightStats.tsx`), a summary row on narrow panels, and the per-outlet dialog in `components/MediaScores.tsx`. Admin → Bugs: "Media scores missing or dropped" and "Decisions not yet read from MMA Decisions" (the backlog), with a re-read action |
| Yearly awards (Sherdog Year-End Awards: Fighter, Breakthrough and Comeback Fighter, Fight, Knockout, Submission and Upset of the Year) | `awards-data.ts` (the winners, edited by hand each January from Sherdog's articles), `awards.ts` (links each to a profile and bout; serves the Awards directory, a profile's awards and a matchup's tags); rows that stop matching, and a year not yet added, in Admin → Bugs |
| Venues and locations | `venues.ts` (identity from ufc.com venue ids + Wikipedia names; locations group cards by the billed city and country) |
| Roster changes (signings, releases) | `roster-moves.ts` (stored read + profile links, ufc.com newest-profile watch); `roster-history.ts` retains dated source evidence; shared `roster-timeline.ts` drives profile bands and the searchable Admin → Bugs backlog for unknown dates/reasons; `import-roster-history.ts` reads weekly roster revisions, `import-roster-reports.ts` retains dated biography evidence through `scrape/roster-reports.ts`; current reports parsed in `scrape/wikipedia.ts` (`rosterChanges`) and `scrape/ufccom.ts` (`parseNewestAthletes`) |
| Admin data-quality board | `bugs.ts` (checks and repair actions), `admin-http.ts`, `repair-guard.ts` |
| Admin panel (sidebar, most important first: Overview, Errors, Slow requests, People → Accounts/Comments/Flags, Data → Bugs/Live rounds, Traffic → Visitors/Server, Settings) | client `pages/AdminPage.tsx`, views in `components/Admin*.tsx`, shared cards/charts in `components/adminKit.tsx` |
| Admin traffic and visitors (live last hour; saved history 24 hours to all time; unique visitors by browser, sources, devices, countries) | `observability.ts` (in memory), `traffic-history.ts` (hourly rows in `scoring.db`, folded to days after 8 days), `visitors.ts` (hashed browser ids for 35 days, then daily totals); client `pageViews.ts` sends the signal |
| Admin errors, slow requests, sync status and accounts | `error-log.ts` (each 5xx/404 address, kept 7 days), `slow-log.ts` (each address that took 300 ms or more, with the time spent getting its data, counted per UTC hour so Admin can pick a window, kept 7 days; client `AdminSlow.tsx`), `sync-status.ts` (source freshness, last 50 sync errors), `accounts.ts` (`adminAccounts`) |
| Accounts, scoring, predictions, bets, comments | `accounts.ts` (Clerk deletions and picture sync), `scoring*.ts`, `predictions*.ts`, `bets*.ts`, `comments*.ts`, `moderation.ts` |
| Background sync | `sync.ts` (scheduler `tick`), `sync-worker.ts` (one at a time via `sync-lease.ts`), `career-records.ts`, `verdict-import.ts`, `verdict-live.ts` (the bout Verdict MMA has on: rounds and fans' average every 15 s) |
| Scrapers | `scrape/ufcstats.ts`, `scrape/ufccom.ts` (schedules, segments, venue/broadcast/referee feed), `scrape/wikipedia.ts` (weigh-ins, infobox, background, replacements and short notice via `boutChanges`, stored by `syncEventWikiInfo`), `scrape/fightodds.ts` (upcoming moneylines and props, matched by UFCStats id; every 5 and 30 min), `scrape/odds.ts` (BestFightOdds: fallback, archive), `scrape/sherdog.ts`, `scrape/verdict.ts`, `scrape/mmadecisions.ts` |
| Database schema and migrations | `db.ts` |

Tests sit beside their module as `*.test.ts`; `npm test` runs them against a
copy of the local archive (`DATA_DIR`).

## Client (`client/src`, React 19 + Tailwind 4)

| Area | Files |
| --- | --- |
| Shell, routes, header | `App.tsx`, `main.tsx` |
| More menu, one column (Stats, News, Browse; then Report an issue, which opens `components/ReportIssueDialog.tsx` about the page being read, asking a signed-out reader to sign in); Browse tabs Roster, Officials (Judges and Referees as tabs of their own from lg), Venues, Locations, Awards, Controversial (below md a page's choice and Filters sit in its list head; `ListHead` in `PageToolbar.tsx`); Graphic (Beta) opens from the profile | `components/MoreNav.tsx`, `components/BrowseTabs.tsx`; page `GraphicPage.tsx` |
| Admin link in the header (admins only) | `App.tsx` (`AdminLink`) |
| News page (newest first, Settings: summaries and outlet toggles); a fighter's News tab | `pages/NewsPage.tsx`, `components/NewsRow.tsx`; `FighterNews` in `pages/FighterPage.tsx` |
| Data fetching and polling | `api.ts` (types + `useApi`), `requestCache.ts`, `polling.ts`; early data in `index.html`, link prefetch in `useLinkPrefetch.ts` + `pageRequests.ts`, page chunks in `pages.ts`, answers kept across reloads in `snapshots.ts` |
| Page choices kept across reloads and releases (Stats filters and board options, Events tier, comment sorts; `useRememberedState`) | `preferences.ts`, `navigationState.ts`; site-wide Settings in `settings.tsx` |
| Events and matchups | `pages/EventsPage.tsx`, `pages/FightPage.tsx`, `components/FightRail.tsx`, `components/FightStats.tsx`; opponent-record drilldown in `components/OppositionDetails.tsx`, the round that decided a decision in `decidingRound.ts`, shared career-evidence dialog in `components/EvidenceDialog.tsx` |
| Fighter profiles (a finish's line, "Knee to Head In Clinch", is UFCStats' `detailsText` via `method_detail`, tidied by `finishDetail` in `format.ts`; missing ones in Admin → Bugs) | `pages/FighterPage.tsx`, `fighterTimeline.ts` (roster bands + DWCS/Road to UFC/TUF labels), `components/FighterStatistics.tsx`, `components/FighterCareerStats.tsx`, `components/FightInsights.tsx` (By round, Average strikes by round, Average scorecards; Records and Statistics sit in the profile's Records tab, Against the odds; also on the matchup); shared career-stat evidence modals in `components/CareerStatDetails.tsx`, with shareable URL controls in `careerMetrics.ts` |
| Controversial decisions and comeback finishes (Browse tab, a judge's Controversial tab, the matchup's controversy line) | `pages/ControversialPage.tsx`, shared row and method note in `components/ControversyRow.tsx`; matchup pieces in `components/FightStats.tsx` (`Scorecards`) |
| Officials, venues, locations and awards | `pages/JudgePage.tsx` (Scorecards and Controversial tabs, "How they score"), `pages/RefereePage.tsx`, `pages/VenuePage.tsx` (venue and location pages), `pages/DirectoryPages.tsx` (the lists, and the Awards page), shared pieces in `components/ResearchKit.tsx` and `research.ts` |
| Typed list filters (spacing, word order and typos forgiven), Roster "new since last visit" | `search.ts` (server twin: `searchList` in `server/src/fuzzy.ts`), `rosterSeen.ts` |
| Admin round switches on the Score tab (same as Admin → Live rounds) | `components/LiveRoundSwitches.tsx`, `components/ScoreRoundControls.tsx`; see `docs/scoring.md` |
| Stream overlay (`/overlay`, `/overlay/:fightId`: the fans' live scorecard for OBS; Score tab button) | `pages/OverlayPage.tsx`, `components/OverlayButton.tsx`; see `docs/scoring.md` |
| Graphics builder (the `/graphic` page) | `pages/GraphicPage.tsx`, `components/GraphicsBuilder.tsx`, `graphics/presets.ts` (the starting points), `graphics/build.ts` (data and picks → graphic), `graphics/render.ts` (templates), `graphics/draw.ts` (themes, texture, type and shared marks), `graphics/fonts.ts` (Barlow Condensed, self-hosted in `public/fonts`), `graphics/export.ts` |
| Keyboard shortcuts | `shortcuts.tsx` |
| Roster changes | `pages/RosterPage.tsx` |
| About / support / changelog | `pages/InfoPage.tsx` |
| Shared definitions | `careerMetrics.ts` (how-they-fight rates), `format.ts`, `ui.ts`, `useMediaQuery.ts`, `components/segmented.ts`, `components/chartTokens.ts` |
| Styles, dark theme and Comfortable type (small print a size up, muted greys darker) | `index.css`, `settings.tsx`, early theme class in `index.html` |

## Docs

`production.md` (hosting, backups, health), `launch.md` (new host),
`local-development.md`, `dev-environment.md`, `performance.md`, `scoring.md`, `discussions.md`,
`predictions.md`, `agent-workflow.md`, `data-repairs/` (dated repair records).

## Development and deployment

`AGENTS.md` owns agent rules. `start` owns local previews, `tools/new-task.sh`
task worktrees, `tools/heavy.sh` heavy-command limits. `deploy/dev-review.sh` +
`dev-review.ts` own the shared dev queue, `deploy/build.sh` the bounded Docker
builder. `deploy/update.sh` releases production without downtime by handing over
between `app-blue` and `app-green` (`deploy/live-app.sh`, `deploy/Caddyfile`). `.github/workflows/ci.yml` owns PR checks and production releases;
`deploy-dev.yml` is the manual dev override.
