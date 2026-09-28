# Roster sources

Investigated 2026-09-28 against the September 25 Roster Watch screenshot.

UFC Roster Watch has historically watched the **UFC fan rankings pool**.
MMA Junkie's reporting explicitly describes additions to that pool, then
independently confirms a signing:
https://ca.sports.yahoo.com/news/ufc-signs-ketlen-souza-invicta-004551640.html
Its present endpoint and polling interval are not publicly confirmed.
We cannot promise to beat every post.

Our direct source is https://www.ufc.com/search?type=athletes&query=
(newest profiles), checked every five minutes by the background scheduler.
Each candidate's profile must read Active. Wikipedia supplements this every
ten minutes; existing fighter profile status checks detect departures.
These are scheduler targets, not guaranteed latency during long sync jobs.

Dev already listed Akbar Abdullaev, Igor Cavalcanti, Mayton Perea and Steven
Koslow. Luis Hernandez was missing: the first watcher run silently learned
all 21 profiles as its baseline, including his. His official profile
https://www.ufc.com/athlete/luis-hernandez was Active and had
article:published_time = 2026-09-16T14:11:55-0500.

A one-time catch-up reads the newest profiles and includes active profiles
published within 30 days. Missing, old and future publication dates are
excluded. These dates are explicitly labeled "UFC profile published": they
are not contract dates. Failed requests retry; the admin roster Bugs category
shows incomplete catch-up with a repair action. This covers the newest page,
not a historical reconstruction of all contracts.

Unread sidebar counts are stored per browser. The initial list is a baseline;
opening Roster clears the counts. Visible sidebars refresh every minute and
follow viewport changes. Source polling is shared on the server, not repeated
against UFC.com for each visitor.
