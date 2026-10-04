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
| Career averages and opponent evidence | `career-metrics.ts` (shared formulas and recorded samples), `career-statistics.ts` (current career or cutoff before a matchup); missing samples in Admin → Bugs |
| In-memory analytics index | `fight-index.ts` (every completed bout, state entering it) |
| Leaderboards | `stats.ts` (fighter cards), `stats-fights.ts` (Fights card: bouts, judges, referees) |
| Potential matchups (pinned unconfirmed odds board, separate from scheduled fights) | `potential-matchups.ts`; synced from FightOdds.io’s future-fights board in `sync.ts` |
| Matchmaking (title fights, ranked pairings, next opponents after recent cards) | `matchmaking.ts` |
| News (outlets, relevance, fighter/event tags, story grouping, newest first, `?fighter=` for one fighter) | `news.ts`; feeds read in `scrape/news.ts` (`NEWS_FEEDS`) |
| News read by Gemini (off by default; enabled in Admin → Health; `GEMINI_API_KEY`) | `news-ai.ts`, run from the API process every 10 minutes |
| Profile records and full stat rankings | `records.ts` (`fighterRecords`, `fighterBoard`, `milestonesWithinReach`) |
| Ranking history (every official list since Feb 2013; ranks entering past bouts, profile chart) | `ranking-history.ts` (archive + Wayback backfill, snapshots from the rankings sync, confirmed undisputed title results shown from fight day without altering official lists); chart `client/src/components/RankingHistory.tsx`; missing history and title evidence in Admin → Bugs |
| Judges and referees | `officials.ts` (name merging, profiles, directory, search) |
| Venues and locations | `venues.ts` (identity from ufc.com venue ids + Wikipedia names; locations group cards by the billed city and country) |
| Roster changes (signings, releases) | `roster-moves.ts` (stored read + profile links, ufc.com newest-profile watch); parsed in `scrape/wikipedia.ts` (`rosterChanges`) and `scrape/ufccom.ts` (`parseNewestAthletes`) |
| Admin data-quality board | `bugs.ts` (checks and repair actions), `admin-http.ts`, `repair-guard.ts` |
| Accounts, scoring, predictions, bets, saved matchmaking cards, comments | `accounts.ts` (Clerk deletions and picture sync), `scoring*.ts`, `predictions*.ts`, `bets*.ts`, `cards*.ts`, `comments*.ts`, `moderation.ts` |
| Background sync | `sync.ts` (scheduler `tick`), `sync-worker.ts`, `career-records.ts`, `verdict-import.ts` |
| Scrapers | `scrape/ufcstats.ts`, `scrape/ufccom.ts` (schedules, segments, venue/broadcast/referee feed), `scrape/wikipedia.ts` (weigh-ins, infobox, background, replacements and short notice via `boutChanges`, stored by `syncEventWikiInfo`), `scrape/fightodds.ts` (upcoming moneylines and props, matched by UFCStats id; every 5 and 30 min), `scrape/odds.ts` (BestFightOdds: fallback, archive), `scrape/sherdog.ts`, `scrape/verdict.ts`, `scrape/mmadecisions.ts` |
| Database schema and migrations | `db.ts` |

Tests sit beside their module as `*.test.ts`; `npm test` runs them against a
copy of the local archive (`DATA_DIR`).

## Client (`client/src`, React 19 + Tailwind 4)

| Area | Files |
| --- | --- |
| Shell, routes, header | `App.tsx`, `main.tsx` |
| More menu, one column (Stats, News, Browse, Matchmaking); Browse tabs Roster, Officials, Venues, Locations; Graphic (Beta) opens from the profile | `components/MoreNav.tsx`, `components/BrowseTabs.tsx`; page `GraphicPage.tsx` |
| Admin link in the header (admins only) | `App.tsx` (`AdminLink`) |
| Matchmaking page (Top 15, recent cards, card builder) | `pages/MatchmakingPage.tsx` |
| News page (newest first, Settings: summaries and outlet toggles); a fighter's News tab | `pages/NewsPage.tsx`, `components/NewsRow.tsx`; `FighterNews` in `pages/FighterPage.tsx` |
| Data fetching and polling | `api.ts` (types + `useApi`), `requestCache.ts`, `polling.ts`; early data in `index.html`, link prefetch in `useLinkPrefetch.ts` + `pageRequests.ts`, page chunks in `pages.ts`, answers kept across reloads in `snapshots.ts` |
| Events and matchups | `pages/EventsPage.tsx`, `pages/FightPage.tsx`, `components/FightRail.tsx`, `components/FightStats.tsx` |
| Fighter profiles | `pages/FighterPage.tsx`, `components/FighterStatistics.tsx`, `components/FighterCareerStats.tsx`; shared career-stat evidence modals in `components/CareerStatDetails.tsx`, with shareable URL controls in `careerMetrics.ts` |
| Officials, venues and locations | `pages/JudgePage.tsx`, `pages/RefereePage.tsx`, `pages/VenuePage.tsx` (venue and location pages), `pages/DirectoryPages.tsx`, shared pieces in `components/ResearchKit.tsx` and `research.ts` |
| Typed list filters (spacing, word order and typos forgiven), Roster "new since last visit" | `search.ts` (server twin: `searchList` in `server/src/fuzzy.ts`), `rosterSeen.ts` |
| Graphics builder | `graphicsLauncher.tsx` (open from anywhere), `components/GraphicsBuilder.tsx` (dialog), `graphics/presets.ts` (the starting points), `graphics/build.ts` (data and picks → graphic), `graphics/render.ts` (templates), `graphics/draw.ts` (themes, texture, type and shared marks), `graphics/fonts.ts` (Barlow Condensed, self-hosted in `public/fonts`), `graphics/export.ts` |
| Keyboard shortcuts | `shortcuts.tsx` |
| Roster changes | `pages/RosterPage.tsx` |
| About / support / changelog | `pages/InfoPage.tsx` |
| Shared definitions | `careerMetrics.ts` (how-they-fight rates), `format.ts`, `ui.ts`, `components/segmented.ts`, `components/chartTokens.ts` |
| Styles and dark theme | `index.css` |

## Docs

`production.md` (hosting, backups, health), `launch.md` (new host),
`dev-environment.md`, `performance.md`, `scoring.md`, `discussions.md`,
`predictions.md`, `data-repairs/` (dated repair records).
