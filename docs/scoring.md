# Fan scorecards

Every completed matchup has a **Score** tab, alongside Result, Matchup and Odds.
The tab also appears on fight day. It holds three panels: the community
scorecard, which is the fan average in decimals; the individual fan cards behind
it, each linking to that scorer's [profile](#profiles); and the reader's own
card. Reading any of them never requires an account.

The account itself lives in the header, beside the theme switch: a person icon
that opens Clerk's sign-in dialog, and once signed in the reader's avatar with
**Manage account** and **Sign out**. Signing in or out always returns to the page
being read rather than the home page, and Clerk's dialogs follow the app's light
or dark theme. The Score tab's own **Sign in to score** button opens the same
dialog. One `ClerkProvider` at the application root serves both, so Clerk loads
with the app rather than with the Score tab.

## Local setup

The application uses React/Vite and Node, so use Clerk's React and backend SDKs
rather than the Next.js SDK:

- [React quickstart](https://clerk.com/docs/react/getting-started/quickstart)
- [Backend request authentication](https://clerk.com/docs/reference/backend/authenticate-request)

Set these in the repository's ignored `.env.local`:

```dotenv
CLERK_PUBLISHABLE_KEY=your_publishable_key
CLERK_SECRET_KEY=your_secret_key
```

Set the public key in `client/.env.local`:

```dotenv
VITE_CLERK_PUBLISHABLE_KEY=your_publishable_key
```

Run `./start`. Backend entry points load the root `.env.local`; Vite loads the
client file. Existing process environment variables take precedence. The secret
key is never a frontend variable. Both local files are ignored by Git and Docker.
Default development origins are localhost and 127.0.0.1 on ports 8000 and 5173.
For another port or LAN access, explicitly set a comma-separated
`CLERK_AUTHORIZED_PARTIES` list containing the frontend origins.

The supplied development instance offers Google sign-in. Enabled sign-in methods
are managed in Clerk; the app uses its standard sign-in/sign-up modal.

## Scoring rules and public numbers

- One card per Clerk user and fight, enforced by a database unique constraint.
  Updating it replaces its contribution rather than adding another vote. A
  decision's **Result** tab carries the fan average beside the judges' cards,
  which opens the Score tab.
- Choose 10–10, 10–9 or 10–8 in either direction; choosing the score already on
  the card takes that round back off it. A **Deduct** button ends each fighter's
  side of the round for the referee's point deductions (zero to two). The API
  still accepts 10–7, which the editor no longer offers.
- Completed cards must include every completed round, starting at round one.
  Stoppage rounds are excluded: both panels end with the finish itself — the
  winner, the method and the time — in place of rounds that were never fought. First-round stoppages have a Score tab explaining
  that there are no completed rounds to score. Historical/unknown formats outside
  confirmed three- and five-round bouts are explained rather than guessed.
- On fight day, a bout with a live statistics feed opens rounds as the feed
  reports them; the editor unlocks each one on its own as the tab polls. The current round may be available: users should save after the
  horn. Unobserved future rounds cannot be submitted. This is community scoring,
  not an official clock or a permanently locked live judging competition.
- The admin panel's **Live rounds** tab shows one bout: the one the header's
  LIVE tag names (the opening bout, then whichever follows the last result),
  with Prev/Next for a feed that is late with a result. That bout's Score tab
  appears as soon as it starts, rounds locked until opened. Closing a round
  by hand deletes the scores entered for it (the panel asks first). When the
  result lands, rounds the bout never reached and a stoppage round are deleted,
  not just hidden, and the hand-opened count is cleared — checked every 15
  seconds, and only for a well-formed result.
- Live users can save a consecutive partial card, then add the next round or edit
  earlier scores. Once a result arrives, the same card becomes a completed-fight
  card. If a round becomes ineligible after a stoppage, all reads and aggregates
  exclude it immediately (subject to the short public cache).
- Round averages use that round's own sample. Decimal totals and verdict counts
  use only cards covering **all currently available rounds**. This prevents a
  one-round partial card from lowering a three-round average. Shortened-fight
  totals describe its scored rounds, not a fight verdict.
- Individual cards are public, under the scorer's chosen username or their
  random public id. That name and the account picture are the only identity any
  public response carries: no Clerk user IDs, emails, real names or tokens.
  A user can remove their card, from the fight page or from their own profile.
  Deletion retains an empty revision tombstone so stale tabs cannot recreate it,
  and a removed card leaves the scorer's profile.
- Unsaved drafts are scoped to the fight and signed-in user in session storage.
  Polling cannot overwrite the editor. Cross-tab conflicts require reloading the
  saved card; they never silently overwrite a newer submission.

## Profiles

Every scorer has a public profile at `/profiles/:handle`. Any reader can open
any profile — no account is needed to read one. The page is tabbed, with
**Scorecards** the only section so far; `?tab=scorecards` addresses it, and the
bar is there because it is what the next section arrives into.

A profile is reached from **My scorecards** in the header's account menu, from
**All your scorecards** on the reader's own card, and from the **Fan scorecards**
panel under a fight, which lists the individual cards behind the community
average and links each one to its scorer.

### Usernames

Every scorer is named the moment they have a profile: a generated name like
`SwiftHook42` is minted on sign-up, before their first card is saved, so nobody
is ever addressed by a bare identifier. They can then choose their own, which is
both what the profile is titled and what addresses it.

Names are **3–20 letters and digits** — no spaces, punctuation or accents, so a
name cannot imitate a path, a public id or another name through spacing tricks.
Capitalisation is kept as typed and dropped from the URL: `FeWdW` displays as
`FeWdW` and lives at `/profiles/fewdw`.

- Uniqueness is case-insensitive and enforced by a unique index on the
  lower-case key, so two readers claiming the same name at the same instant
  cannot both be told yes. Every capitalisation of a taken name is taken.
- Recapitalising a name you already hold always succeeds and keeps the same
  address, so the profile is reloaded in place rather than navigated. Renaming
  frees the old name for someone else, and the address bar follows the new one
  immediately.
- Reserved names — `me`, `admin`, `api`, `fights`, `settings` and the rest of the
  application's own vocabulary — are refused.
- Claiming is rate limited per account, and the field refuses locally whatever
  the server would refuse.
- A generated name is drawn again until a free one is found; the unique index
  decides, so two accounts created in the same instant cannot be given the same
  name. A public id keeps working as an address after any rename, so old links
  survive.

The account picture is copied from Clerk — at most once a day per scorer, on
the reader's own authenticated profile request, never on a scorecard save. Only
`img.clerk.com` and `images.clerk.dev` URLs are stored, so a profile page cannot
be turned into a beacon for anywhere else. Nothing else about the account is
copied: no name, no email, no address.

### Scorecards

Each row is one line of two fighters with their photographs and the reader's
score between them, over one line naming the event, the date, the division,
whether the card agreed with the judges and how the bout ended. The round scores
themselves are on the fight page, not repeated here. The row opens that bout at
`/fights/:id?tab=score`, which is both where the card is read in full and where
it is changed: rescoring a fight is one click from the list. On the reader's own
profile each row carries a quiet **×** in its corner, which opens a dialog
before anything is deleted.

A **search box** narrows the list by either fighter, the event or the division,
in any capitalisation. It searches every card on the profile rather than the
page on screen, and is applied on the server alongside the filter.

An **agreement** chart sits above the list: of the bouts that went to the
judges, how many this scorer read the same way. Either half of it — green for
agreed, red for disagreed — opens the cards behind it. A card agrees only if the
bout was a decision, was scored to its last available round, and named the same
winner; an even card on a decision disagrees, because the judges named one. A
finish is neither: it was never judged. The list therefore opens on judged bouts
only, and a **Hide finishes** checkbox — on by default — brings the rest back.
A profile that has never scored a finish has nothing to hide, so it is not
offered the checkbox at all. The list is titled **Scored fights** whatever it is
filtered to; the counts beneath it say how much of the profile is showing.

Changing a filter, clicking the chart or typing in the search box never blanks
the page: the previous answer stays on screen, dimmed, until the next arrives.

The tally always describes the whole profile, not the page being read. The list
loads a page at a time as it is scrolled, one request at a time, so a profile
with hundreds of cards opens as quickly as one with five. A profile considers
its **1000 most recent cards**; beyond that the oldest are not listed or counted.

Profiles show the same rounds the fight page does. A round that stopped being
scorable (a bout scored live that later ended in a stoppage) is dropped from a
profile exactly as it is from the fight's own panels, so the two never disagree.

## API and security

```text
GET    /api/fights/:id/scores                public summary, including recent individual cards
GET    /api/fights/:id/scores/mine           authenticated saved card
PUT    /api/fights/:id/scores/mine           { revision, rounds }
DELETE /api/fights/:id/scores/mine           { revision }
GET    /api/profiles/:handle[?filter=&q=&offset=]  public profile: a tally and one page of cards
GET    /api/profiles/mine                    authenticated; the reader's own identity
PUT    /api/profiles/mine                    { username }
```

`:handle` is a username or a public id. `filter` is `all`, `decisions`,
`agreed` or `disagreed`; anything else is a 400, as is a non-numeric `offset` or
a `q` over 60 characters. A taken username is a 409, an invalid or reserved one
a 400.

`GET /api/profiles/mine` mints the reader's public id on first use, so a reader
who has not saved a card yet still has a profile to open and share, and
refreshes the account picture at most once a day. It is the only authenticated
read that writes, and it is idempotent; Clerk being unreachable leaves the
stored picture in place rather than failing the request.

Profile responses are public and briefly cached. Saving a card, removing one or
changing a username invalidates that profile under every address it answers to
by bumping a per-handle generation the cache key carries — one map write, on a
path a scorecard save is on, rather than a scan of the cache.

Each round is `{ round, f1, f2, deduct1, deduct2 }`. `revision` is the last saved
version (initially zero); stale writes return 409. All writes are transactional.
The server derives the owner from a verified Clerk session token, never the body.
Only explicit bearer session tokens are accepted. Clerk checks their signatures,
expiry and authorized origins; API keys, cookie-only requests and cross-site
writes are rejected. Private responses and all errors are `private, no-store`.
JSON bodies are limited to 4 KiB. Per-IP and per-user rate limits protect reads,
authentication and writes. Only explicitly trusted proxies can supply client IPs.

## Deployment and capacity

Set production Clerk keys in the deployment `.env` (see `.env.example`). Docker
passes only the publishable key as a client build argument. Compose supplies
`https://${DOMAIN}` as the authorized origin. Add other intentional frontend
origins explicitly when running outside Compose. Configure the production
instance/domain in Clerk before public deployment; the supplied test keys are
for development. Without configured authentication, public browsing still works
and private scoring fails closed.

Fights named on a profile are read from `ufc.db` in one batch per request,
since the two databases cannot be joined. Every statement the scoring store runs
is compiled once and reused. A profile with 600 cards answers a page in under
two milliseconds on the local test host, before the response cache.

Fan data lives in `DATA_DIR/scoring.db`, separate from `ufc.db`. Both use SQLite
WAL. Fan writes cannot invalidate the historical analytics cache or contend with
the scraper's write transactions. Public summaries have a bounded, three-second
origin cache, which a save drops for that fight so the scorer's own card is in
the summary they reload; browsers poll them every five seconds, with jitter,
hidden-tab suspension and error backoff. No Clerk user-profile API request is needed
per submission. Clerk caches signing keys; optionally configure `CLERK_JWT_KEY`
with the instance's public PEM verification key for networkless verification.

The supported deployment is the existing **single API process on one persistent
volume**, with separate query workers/scraper. In-memory rate limiting and caches
are per API process. Horizontal replicas need shared rate limits and an explicit
database deployment strategy. This change is not a claim of unlimited scale.

Back up **both** databases using SQLite's online backup facility, for example:

```bash
node server/src/backup.ts server/data/ufc.db backups/ufc-2026-09-17.db
node server/src/backup.ts server/data/scoring.db backups/scoring-2026-09-17.db
```

Do not copy live database files without their WAL state. Restore both databases
before restarting. Saved cards and scorer aliases are user data and should follow
the deployment's retention policy.

## Verification

`node --test server/src/scoring.test.ts` runs isolated SQLite fixtures, rule and
aggregate checks, ownership, duplicate/stale writes, deletion,
live-to-stoppage transitions, profile listing (ordering, removed cards, dropped
rounds, missing bouts and name-only identity), minted names, username
validation, reservation, case-insensitive uniqueness and recapitalisation, the
agreement tally, each filter and the search, HTTP validation, origin checks,
rate limits and
cryptographic Clerk token verification (valid, expired, tampered and wrong-origin
sessions). Its separate load-driver process submits **300 simultaneous cards**
and makes **300 simultaneous public reads**, asserting exact participant counts
and totals. The load driver injects test identities; Clerk verification is tested
separately, so this is local application capacity evidence, not a hosted Clerk or
production-network benchmark. All fixture data is removed afterward.

`npm test --prefix server`, `npm test --prefix client`, client build/lint and
server TypeScript checking cover the surrounding application.
