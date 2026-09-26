# Development workflow

## About

- UFC.sh is the number one platform for UFC data: accurate and simple.
- Accuracy is the most important thing. We deliver complex data in a way that's fast and easy to digest. Data should always be as accurate as possible and the UI as simple as possible.

## Efficiency

- Be as token efficient as possible without sacrificing quality. If a fix is quick and simple and doesn't need testing, don't test it.
- When you finish, reply in short sentences with as little text as possible. Summarize what you did and, if needed, why.
- I like simple systems and software that feels obvious. Don't preserve complexity just because it exists. Don't add machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

## Repos and folders

- `/home/ubuntu/ufcsh`: production checkout. Always clean on `main`. Never edit, branch, or stash here.
- `/home/ubuntu/ufcsh-dev`: dev repo. Base for worktrees; don't work in it directly.
- `/home/ubuntu/ufcsh-wt/<branch-name>`: one worktree per task. All feature work happens here.

## Feature work

- Every task gets its own branch and worktree, even if you think you're the only agent running:
  `git -C /home/ubuntu/ufcsh-dev fetch && git -C /home/ubuntu/ufcsh-dev worktree add /home/ubuntu/ufcsh-wt/<branch-name> -b <category>/<branch-name> origin/main`
- Branch names are short and meaningful, with a category prefix: `feat/`, `bug/`, `perf/`, `chore/`. Example: `bug/fighter-record-totals`.
- In a new worktree, run `npm ci --prefix client` and `npm ci --prefix server` before running checks.
- Never commit to `main`. Never merge. Merging is a production release.
- When a change is complete and checks pass, commit and push without asking. On a branch's first push, open a PR to `main`; later pushes update it.
- After I merge a PR, pull `main` in `/home/ubuntu/ufcsh` so it matches the latest version, and remove that branch's worktree with `git -C /home/ubuntu/ufcsh-dev worktree remove <path>`.

## Parallel agents

- Several agents may run at once. Only touch your own worktree. Never switch branches, stash, reset, or edit files in another agent's worktree or in `/home/ubuntu/ufcsh-dev`.
- If two tasks need the same files, say so instead of working around it.
- Tests that write data use their own copy of the data (`DATA_DIR=<your copy>`), never the shared dev volume.

## Dev deploys and review

- Pushing any branch other than `main` deploys it to https://dev.ufc.sh. Dev shows one branch at a time, so another agent's push can replace yours.
- After pushing, wait for the deploy, then confirm dev is healthy and serving your branch's latest commit. Then tell me to reload dev to review, and name the branch.
- If another branch has taken over dev, say so and name your branch so I can switch with the **Choose dev branch** GitHub Action.
- Verify only on dev. Never run `./deploy/update.sh` unless I ask.

## Production releases

- Production is https://ufc.sh. Every successful CI run for a push or merge to `main` automatically deploys to production, and moves dev onto `main` so dev and production match.
- Merging or pushing to `main` is a production release. Do it only when I explicitly ask.
- For a manual recovery deployment, run `./deploy/update.sh` from `/home/ubuntu/ufcsh` on a clean `main`, and only when I ask.

## Rebuild behavior

- The dev app runs from a Docker image. Code changes aren't live through hot reload.
- Deploy your changes to dev by pushing your branch. Don't run `/home/ubuntu/ufcsh/dev.sh` from a worktree: it rebuilds from `/home/ubuntu/ufcsh-dev`, not your worktree, and would overwrite another agent's deploy.
- To switch the branch shown on dev by hand, use `./deploy/select-dev-branch.sh BRANCH` from `/home/ubuntu/ufcsh` or the **Choose dev branch** GitHub Action. Only do this when I ask.

## Secrets and data

- Never commit, print, or share `.env`, `.env.dev`, Clerk secret keys, or Cloudflare Tunnel credentials.
- Use development credentials and the development data volume for dev work.
- Never point dev at the production database or modify production data during feature development.
- `.env.dev.example` is a template. Real local credentials go in the ignored `.env.dev` file. New worktrees need their own `.env.dev` copied from `/home/ubuntu/ufcsh-dev`; never commit it.

## Working in the code

- Start from `docs/project-map.md` to find the file that owns a feature.
- Checks before a push:
  - `npm test --prefix client`
  - `server/node_modules/.bin/tsc --noEmit -p server/tsconfig.json`
  - `npm run lint --prefix client`
  - `npm run build --prefix client`
  - Full server suite (needs the archive): `DATA_DIR=<copy of data> npm test --prefix server`
- New data, or data that could break in the future, gets a category on the admin Bugs board (`/admin?tab=bugs`, `server/src/bugs.ts`), with a repair action where one exists.
- Measure before optimizing. Record results in `docs/performance.md`.
- Everything must work and look right in dark and light mode, on all screen sizes, devices, and browsers. People use different devices differently; optimize for all of them.
- UFC.sh serves thousands of concurrent users. Lots of apps get bogged down by bad tech decisions and slop; we haven't, and we're proud of our performance. Consider the performance impact of every change, and keep the UI fast and responsive.
- Keep the codebase clean and easy to maintain over time. Keep solutions simple and match the existing style.
