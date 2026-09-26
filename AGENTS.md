# Development workflow

## Efficient

- Be as token efficient as possible without sacrificing quality. Get tasks done, if you dont need to test it and it's a quick simple fix then dont test it.
- When you're done running always reply with short sentences and as few text as possible. Summarize what you did and if needed, why.
- I like simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

## Feature work

- Work on a feature branch in `/home/ubuntu/ufcsh-dev`. Never commit to `main`, and leave `/home/ubuntu/ufcsh` clean on `main`, because production deploys from it.
- When a change is complete and the checks pass, commit and push without asking. On a branch's first push, open a PR to `main`; later pushes update it. Never merge. Merging is a production release.
- Pushing deploys the branch to https://dev.ufc.sh. Wait for the deploy, confirm dev is healthy, then tell me to reload dev to review. Verify only on dev; never run `./deploy/update.sh` unless I ask.
- After you merge always pull main on your VPS to make sure its latest version locally.

## Production releases

Production is `https://ufc.sh`. Every successful CI run for a push or merge to `main` automatically deploys the new main branch to production. Therefore, merging or pushing to `main` is a production release: do it only when the user explicitly asks. For a manual recovery deployment, run `./deploy/update.sh` from the clean production checkout on `main`.

## Secrets and data

- Never commit, print, or share `.env`, `.env.dev`, Clerk secret keys, or Cloudflare Tunnel credentials.
- Use the development credentials and development data volume when working on dev.
- Do not point dev at the production database or modify production data during feature development.
- `.env.dev.example` is a template; actual local credentials belong in the ignored `.env.dev` file.

## Rebuild behavior

The dev app runs from a Docker image; code changes are not live through host-based hot reload. Run `/home/ubuntu/ufcsh/dev.sh` after making changes so the dev image is rebuilt from the active dev worktree. Every push to a branch other than `main` automatically deploys that branch to `dev.ufc.sh`, and every push or merge to `main` moves dev onto `main` once CI passes, so dev and production match. To switch the branch shown at `dev.ufc.sh` by hand, use `./deploy/select-dev-branch.sh BRANCH` from the production checkout or the **Choose dev branch** GitHub Action; commit or stash changes in the dev worktree before switching.

## Working in the code

- Start from `docs/project-map.md` to find the file that owns a feature.
- Checks before a push: `npm test --prefix client`, `server/node_modules/.bin/tsc --noEmit -p server/tsconfig.json`, `npm run lint --prefix client`, `npm run build --prefix client`. The full server suite needs the archive: `DATA_DIR=<copy of data> npm test --prefix server`.
- Data-quality gaps a feature can leave behind belong on the admin Bugs board (`server/src/bugs.ts`) with a repair action where one exists.
- Measure before optimising; record results in `docs/performance.md`.
- When you add new data or data that could potentially break in the future make to add it as a category in the /admin?tab=bugs tab.
- When you work on something make it work and look in dark mode and light mode and all screen sizes, devices and browsers
- Users on different devices use them differently, so your implementation should be optimized for everyone
- UFC.sh is used by thousands of concurrent users, lots of apps have gotten bogged down with bad tech decisions and "slop". We have not, and we're proud of the performance make sure all changes are considerate of performance impact, but also make it fast and responsive to the user using it.
- The number one most important thing for the app is ACCURACY and SIMPLICITY. We deliver complex data in a way it's fast and easy to digest. Data should always be as accurate as possible and UI should always be as simple as possible.
- Keep codebase clain and easy to maintain overtime. Keep solutions simple and always keep similar and consistent stylign to the rest of the codebase.
