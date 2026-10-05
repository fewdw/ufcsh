# UFC.sh development

Accuracy first. Keep the UI fast, simple, and correct in light/dark mode and on
small/large screens. Prefer the smallest maintainable solution.

## Two hosts

- **Home server** (`dev-pc`, clone `/home/fred/Projects/ufcsh`): where features are
  built and reviewed on private Tailscale URLs, several at once.
- **VPS** (`ssh ufcsh-vps`, `/home/ubuntu`): production `ufc.sh` runs clean `main`
  from `/home/ubuntu/ufcsh`; `dev.ufc.sh` (Docker, behind Cloudflare Access) deploys
  from `/home/ubuntu/ufcsh-dev`. Never edit, branch, stash, or commit in either.

## Tasks

- Every task gets its own branch and worktree, on either host:
  `./tools/new-task.sh feat/NAME` (`feat`, `bug`, `perf`, `chore`) creates
  `../ufcsh-wt/NAME` from fresh `origin/main`. Work only there; leave the main
  clone and other tasks' worktrees alone.
- Use `docs/project-map.md` when the feature owner isn't clear. Read only the
  files/docs needed; use bounded searches/output and batch independent reads.

## Showing the work

- **"Give me a Tailscale URL" (home server default):** run `./start` in the task
  worktree and reply with the URL it prints. It takes a couple of seconds: no build,
  Docker, or CI. Frontend and API edits hot reload on the same URL. Each worktree
  has its own port and data copy, so leave previews running for review.
  `./start stop` when the task is merged or dropped; `./start logs` if it fails.
- **"Put X in dev" (only when asked):** push, then on the VPS run
  `./deploy/dev-review.sh priority BRANCH FULL_PUSHED_SHA`. From the home server:
  `ssh ufcsh-vps 'cd /home/ubuntu/ufcsh-dev && ./deploy/dev-review.sh priority BRANCH SHA'`.
  It builds a Docker image, verifies commit and readiness, and keeps the previous
  review queued. Report the branch and ask to reload dev. Other commands (`status`,
  `next`, `release BRANCH`) are in `docs/agent-workflow.md`. Never use `dev.sh` or
  the internal selector directly.
- Previews are tailnet-only: Tailscale Serve, never Funnel; servers stay on loopback.

## Proportional verification

- Docs, comments, obvious copy fixes: inspect the diff. Isolated behavior: relevant
  existing tests/checks. Visual or interaction changes: look at the affected screen
  in the preview when that resolves uncertainty. Never open a browser merely to
  prove completion.
- Data, records, statistics, schema, auth, or shared logic: meaningful regression
  checks, expanding coverage with risk. A one-line formula can be high risk.
- Run installs, TypeScript, builds, and the full server suite through
  `./tools/heavy.sh COMMAND ...` (one heavy job at a time across chats). Reuse passed
  checks while relevant code is unchanged. Don't add tests that merely repeat
  trivial implementation. Report actual verification briefly.
- Available checks: client tests/lint/build; server `tsc --noEmit -p
  server/tsconfig.json`; full server suite with `DATA_DIR=<private archive copy>`.
  Never let tests write to a preview's data, a shared dev volume, or production.
- Measure before optimizing; record results in `docs/performance.md`. Data that
  could break needs an admin Bugs category (`server/src/bugs.ts`) and a repair
  action where available.

## Finish

- Commit, push, and open a **draft PR** to `main` without asking. Pushes do not run
  CI or deploy. Report the PR, the preview URL, and what was verified.
- CI runs when a draft PR is marked ready, and on `main`. Finish the batch of edits,
  push, and confirm the PR `headRefOid` matches local `HEAD` first. To check a new
  revision: `gh pr ready --undo` then `gh pr ready`; rerunning an old run checks old code.
- Merge/push to `main` only with explicit user authorization. Before that merge,
  update the branch against current `main`, replace the entire changelog in
  `client/src/pages/InfoPage.tsx` with the release date and a few short lines,
  push, then request final CI. Production deploys after successful main checks.
  Never run `deploy/update.sh` unless asked.
- After a merge: `./start stop`, release dev if this branch was on it
  (`./deploy/dev-review.sh release BRANCH` on the VPS), remove the worktree, and
  delete the local/remote branches.

## Secrets

- This repo is public. Use development credentials/data only. Never print or commit
  `.env*`, Clerk secrets, Tunnel credentials, or archive data. Previews read the
  main clone's ignored `.env.dev`; never `.env`.
