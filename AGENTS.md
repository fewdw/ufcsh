# UFC.sh development

Accuracy first. Keep the UI fast, simple, and correct in light/dark mode and on
small/large screens. Prefer the smallest maintainable solution.

## Local tasks and previews (default)

- Develop locally; `ts` means **Tailscale**. Build the feature, verify it, launch
  its private preview, and send the URL. Docker, GitHub CI, and the VPS are not
  prerequisites for reviewing a feature.
- The local clone is `/home/fred/Projects/ufcsh`; leave its checkout alone.
  Every task uses a branch/worktree under `/home/fred/Projects/ufcsh-wt`:
  `./tools/new-task.sh feat/NAME` (categories: `feat`, `bug`, `perf`, `chore`).
  From another local clone the script uses the same sibling `ufcsh-wt` layout.
  Continue an existing task in its own worktree; never repair another task's checkout.
- Run `./start ts` from the task worktree. It installs missing/changed dependencies
  through `tools/heavy.sh`, starts the API with Node watch and the client with Vite,
  verifies readiness, and prints a private HTTPS URL. It reuses a healthy preview;
  frontend edits hot reload and API edits restart automatically. No client build.
- Each worktree has its own ports, service, and ignored `.local-preview/data` copy.
  Previews survive the agent command ending. Leave the preview available for review;
  `./start status` checks it, `./start stop` stops only that worktree. Stop it before
  removing the worktree. Never kill a listener or reset Tailscale Serve to free a port.
- Use the existing private `.env.dev` in the task or original clone; the launcher
  maps `DEV_*` credentials and uses the preview URL for Clerk/origin checks. Never
  use production keys or `.env`. Seed data comes from `~/.local/share/ufcsh/dev-seed`;
  SQLite backups and copied images isolate writes. Sync defaults off for fast previews;
  set `TS_NO_SYNC=0` in private `.env.dev` when the task requires syncing.
- Bind local servers to loopback. Use Tailscale **Serve**, never **Funnel**; allow
  only the exact preview hostname in Vite. Never expose env files, database snapshots,
  or secrets. The Mac/phone must be connected to the same tailnet with access to this
  host. See [local development](docs/local-development.md) for setup/troubleshooting.
- Read [project map](docs/project-map.md) when ownership is unclear. Read only the
  files/docs needed; use bounded searches/output and batch independent reads.
  Delegate only independent work that benefits from it.

## Proportional verification

- Docs/comments/copy: inspect the diff. Isolated behavior: relevant existing checks.
  Visual/interaction changes: inspect the affected local preview when it resolves
  uncertainty. Never open a browser just to prove completion.
- Data, records, statistics, schema, auth, or shared logic need meaningful regression
  checks proportional to risk. Tests must use private data copies, never shared dev
  volumes or production. Data that could break needs an admin Bugs category
  (`server/src/bugs.ts`) and a repair action where available.
- Run installs, TypeScript, builds, and full server tests through `./tools/heavy.sh
  COMMAND ...`. Install only dependencies needed, once per worktree. Reuse passing
  checks while relevant code/dependencies/fixtures are unchanged; after an edit or
  failure rerun affected checks first. Don't add tests for trivial implementation.
- Checks: client tests/lint/build; server `tsc --noEmit -p server/tsconfig.json`;
  full server suite with `DATA_DIR=<private archive copy>`. For the preview launcher:
  `node --test tools/local-preview.test.ts`.
- Measure before optimizing; record results in `docs/performance.md`. Avoid extra
  servers, watchers, builds, or browsers without a need. Never kill another agent
  to free RAM. Keep one heavy job; the optional `tools/agent-session.sh` caps three
  sessions only when T3 actually launches through it. See [agent workflow](docs/agent-workflow.md).

## Finish and GitHub

- Commit/push completed work and open a **draft PR** to `main` without asking.
  Pushes save work; they don't run CI or deploy. Link the PR to the T3 thread when
  its tools are available. Report the PR/branch, preview URL, and actual verification.
- Default review is local Tailscale; don't enqueue/deploy to `dev.ufc.sh` unless
  requested. If the user asks for no preview, skip launching. Leave existing reviews running.
- CI runs when a draft PR is marked ready and on `main` releases. Finish the edit
  batch, push, and confirm the PR `headRefOid` matches local `HEAD` before requesting
  CI. For a new revision use `gh pr ready --undo` then `gh pr ready`; rerunning an
  old run checks old code. Keep required checks and up-to-date protection.

## VPS dev (explicit requests)

- `dev` / `dev.ufc.sh` means the Docker dev environment on `ssh ufcsh-vps`, protected
  by Cloudflare Tunnel/Access. `ts` means this machine's fast private preview.
  Production `ufc.sh` is clean `main` at `/home/ubuntu/ufcsh`; never edit, branch,
  stash, or commit there. `/home/ubuntu/ufcsh-dev` is a deployment checkout, not an
  editing checkout. VPS tasks use their own `/home/ubuntu/ufcsh-wt/NAME` worktree.
- To show a pushed local branch on VPS dev, run the coordinator **on the VPS**:
  `ssh ufcsh-vps 'cd /home/ubuntu/ufcsh-dev && ./deploy/dev-review.sh priority BRANCH FULL_PUSHED_SHA'`.
  `priority` preserves the previous review in the queue. For ordinary queued VPS
  review use `ready BRANCH SHA`; the first finished task claims dev, later tasks
  queue and return without polling. Never replace a review implicitly.
- Coordinator commands on the VPS: `status`, `next`, `release OWNER_BRANCH`,
  `skip BRANCH`. No expiration silently replaces a review; failed deployments
  retain their slot. Same-owner fixes can deploy. Deploy commands verify commit
  and readiness. If deployed, name the branch and ask to reload dev; if queued or
  skipped, say "not deployed to dev". Local ts alone is not a VPS deployment.
- Manual override: **Actions → Choose dev branch → Run workflow → pick branch**.
  Never bypass the queue with `dev.sh` or the internal selector. Docker dev has no
  hot reload. See [VPS dev guide](docs/dev-environment.md) for tunnel, volumes, and secrets.

## Production releases (explicit authorization)

- Merge/push to `main` only when authorized. Update against current `main`, replace
  the entire changelog in `client/src/pages/InfoPage.tsx` with the release date and
  a few short lines, push, then request final CI. Production deploys after successful
  main checks; it does not reset dev. Never run `deploy/update.sh` unless asked.
- After merging, pull production `main` on the VPS under the Git fetch lock, then
  call its `./deploy/dev-review.sh release MERGED_BRANCH` (advances only its owner).
  Stop the local preview, remove your worktree, and delete local/remote task branches.
  Release before removing a VPS task's worktree so its script is available.
- This repo is public. Never print or commit `.env*`, Clerk secrets, Tunnel
  credentials, or private data. Only documented `.env*.example` templates belong
  in Git. Use development credentials/data for all local work.
