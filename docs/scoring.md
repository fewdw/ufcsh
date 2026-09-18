# Fan scorecards

Every completed matchup has a **Score** tab, alongside Result, Matchup and Odds.
The tab also appears on fight day. It holds two panels: the community scorecard,
which is the fan average in decimals, and the reader's own card. Reading the
community numbers never requires an account.

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
- Live users can save a consecutive partial card, then add the next round or edit
  earlier scores. Once a result arrives, the same card becomes a completed-fight
  card. If a round becomes ineligible after a stoppage, all reads and aggregates
  exclude it immediately (subject to the short public cache).
- Round averages use that round's own sample. Decimal totals and verdict counts
  use only cards covering **all currently available rounds**. This prevents a
  one-round partial card from lowering a three-round average. Shortened-fight
  totals describe its scored rounds, not a fight verdict.
- Only aggregates are public: individual cards are never listed. Public endpoints
  never return Clerk user IDs, emails, real names, or tokens. Each scorer still
  holds a stable random public alias, which no public response exposes today. A
  user can remove their card. Deletion retains an empty revision tombstone so
  stale tabs cannot recreate it.
- Unsaved drafts are scoped to the fight and signed-in user in session storage.
  Polling cannot overwrite the editor. Cross-tab conflicts require reloading the
  saved card; they never silently overwrite a newer submission.

## API and security

```text
GET    /api/fights/:id/scores               public summary
GET    /api/fights/:id/scores/mine          authenticated saved card
PUT    /api/fights/:id/scores/mine          { revision, rounds }
DELETE /api/fights/:id/scores/mine          { revision }
```

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
live-to-stoppage transitions, HTTP validation, origin checks, rate limits and
cryptographic Clerk token verification (valid, expired, tampered and wrong-origin
sessions). Its separate load-driver process submits **300 simultaneous cards**
and makes **300 simultaneous public reads**, asserting exact participant counts
and totals. The load driver injects test identities; Clerk verification is tested
separately, so this is local application capacity evidence, not a hosted Clerk or
production-network benchmark. All fixture data is removed afterward.

`npm test --prefix server`, `npm test --prefix client`, client build/lint and
server TypeScript checking cover the surrounding application.
