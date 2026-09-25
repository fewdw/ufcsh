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
| In-memory analytics index | `fight-index.ts` (every completed bout, state entering it) |
| Leaderboards / Labs | `stats.ts`, `labs.ts`, `labs-insights.ts`, `labs-explore.ts` |
| Profile records and full stat rankings | `records.ts` (`fighterRecords`, `fighterBoard`, `milestonesWithinReach`) |
| Judges and referees | `officials.ts` (name merging, profiles, directory, search) |
| Venues | `venues.ts` (identity from ufc.com venue ids + Wikipedia names) |
| Admin data-quality board | `bugs.ts` (checks and repair actions), `admin-http.ts`, `repair-guard.ts` |
| Accounts, scoring, predictions, bets, comments | `scoring*.ts`, `predictions*.ts`, `bets*.ts`, `comments*.ts`, `moderation.ts` |
| Background sync | `sync.ts` (scheduler `tick`), `sync-worker.ts`, `career-records.ts`, `verdict-import.ts` |
| Scrapers | `scrape/ufcstats.ts`, `scrape/ufccom.ts` (schedules, segments, venue/broadcast/referee feed), `scrape/wikipedia.ts` (weigh-ins, infobox, background), `scrape/odds.ts`, `scrape/sherdog.ts`, `scrape/verdict.ts`, `scrape/mmadecisions.ts` |
| Database schema and migrations | `db.ts` |

Tests sit beside their module as `*.test.ts`; `npm test` runs them against a
copy of the local archive (`DATA_DIR`).

## Client (`client/src`, React 19 + Tailwind 4)

| Area | Files |
| --- | --- |
| Shell, routes, header | `App.tsx`, `main.tsx` |
| Data fetching and polling | `api.ts` (types + `useApi`), `requestCache.ts`, `polling.ts`; early data in `index.html`, link prefetch in `useLinkPrefetch.ts` + `pageRequests.ts`, page chunks in `pages.ts`, answers kept across reloads in `snapshots.ts` |
| Events and matchups | `pages/EventsPage.tsx`, `pages/FightPage.tsx`, `components/FightRail.tsx`, `components/FightStats.tsx` |
| Fighter profiles | `pages/FighterPage.tsx`, `components/FighterStatistics.tsx` |
| Officials and venues | `pages/JudgePage.tsx`, `pages/RefereePage.tsx`, `pages/VenuePage.tsx`, `pages/DirectoryPages.tsx`, shared pieces in `components/ResearchKit.tsx` and `research.ts` |
| Graphics builder | `graphicsLauncher.tsx` (open from anywhere), `components/GraphicsBuilder.tsx` (dialog), `graphics/build.ts` (data → graphic), `graphics/render.ts` (canvas drawing), `graphics/export.ts` |
| Keyboard shortcuts | `shortcuts.tsx` |
| About / sources / changelog | `pages/InfoPage.tsx` |
| Shared definitions | `careerMetrics.ts` (how-they-fight rates), `format.ts`, `ui.ts`, `components/segmented.ts`, `components/chartTokens.ts` |
| Styles and dark theme | `index.css` |

## Docs

`production.md` (hosting, backups, health), `launch.md` (new host),
`dev-environment.md`, `performance.md`, `scoring.md`, `discussions.md`,
`predictions.md`, `labs-categories.md`, `data-repairs/` (dated repair records).
