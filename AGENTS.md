# UFC.sh development

Accuracy first. Keep the UI fast, simple, and correct in light/dark mode and on
small/large screens. Prefer the smallest maintainable solution.

## Task isolation

- Production: `/home/ubuntu/ufcsh`, clean `main`. Never edit, branch, stash, or
  commit here. `/home/ubuntu/ufcsh-dev` is the deployment checkout; don't edit it.
- Every task uses its own branch/worktree, even with one agent:
  `flock -w 600 /tmp/ufcsh-git-fetch.lock git -C /home/ubuntu/ufcsh-dev fetch`
  then `git -C /home/ubuntu/ufcsh-dev worktree add /home/ubuntu/ufcsh-wt/NAME -b CATEGORY/NAME origin/main`.
  Categories: `feat/`, `bug/`, `perf/`, `chore/`.
- Only touch your worktree. Coordinate overlapping file changes; don't repair
  another task's checkout. Delegate only independent work that benefits from it.
- Use `docs/project-map.md` when the feature owner isn't clear. Read only the
  files/docs needed; use bounded searches/output and batch independent reads.

## Proportional verification

- Docs, comments, obvious copy fixes: inspect the diff; no installs, build,
  tests, or browser unless there is a concrete uncertainty.
- Isolated behavior: relevant existing tests/checks. Visual or interaction
  changes: inspect the affected screen on dev when that can resolve uncertainty.
  Never launch a browser merely to prove completion.
- Data, records, statistics, schema, auth, or shared logic: meaningful regression
  checks, expanding coverage with risk. A one-line formula can be high risk.
- Install only the dependencies needed by the chosen checks, once per worktree:
  `./tools/heavy.sh npm ci --prefix client` / `--prefix server`.
- Run heavy local checks through `./tools/heavy.sh COMMAND ...`, including
  TypeScript, builds, the full server suite, and dependency installs. It queues
  across chats, waits for memory headroom, and caps descendants on this server.
  Don't start extra app servers, watchers, builds, or browsers without a need.
- Reuse passed checks while relevant code, dependencies, and fixtures are
  unchanged. After a failure/edit, rerun affected checks first. Don't add tests
  that merely repeat trivial implementation. Report actual verification briefly.
- Available checks: client tests/lint/build; server `tsc --noEmit -p
  server/tsconfig.json`; full server suite with `DATA_DIR=<private archive copy>`.
  Never let tests write to a shared dev volume or production data.
- Measure before optimizing; record results in `docs/performance.md`. Data that
  could break needs an admin Bugs category (`server/src/bugs.ts`) and a repair
  action where available.

## Finish, push, and dev

- Commit/push completed work and open a **draft PR** to `main` without asking.
  Pushes do not run CI or deploy. A push is not a completed task.
- After finishing implementation and appropriate verification, call from your
  worktree: `./deploy/dev-review.sh ready BRANCH FULL_PUSHED_SHA`.
  The **first finished agent claims dev**. Later finishers queue and return
  without waiting for the review; do not poll or replace its deployment.
- Explicit user intent overrides the default:
  - "Don't deploy in dev": `./deploy/dev-review.sh skip BRANCH`; never call ready.
  - "Put/deploy/show this in dev": `./deploy/dev-review.sh priority BRANCH SHA`.
    It replaces the selection once ready, preserving the previous task in the
    queue. Mentioning dev while discussing policies is not a deployment request.
- "Next": `./deploy/dev-review.sh next`. "Release dev":
  `./deploy/dev-review.sh release OWNER_BRANCH`. `status` shows owner/queue.
  No expiration silently replaces a review. Failed deployments retain their
  slot until retried or explicitly replaced. Same-owner follow-up fixes can deploy.
- Deploy commands serialize and verify the running container's commit/readiness.
  If deployed, report branch and ask to reload dev. If queued/skipped, report
  branch/PR and "not deployed to dev". Do not open a browser for an infrastructure
  or copy-only task when the command's health/commit check is sufficient.
- Manual fallback: **Actions → Choose dev branch → Run workflow → pick branch**.
  This is an explicit override. Never use `dev.sh` or the internal selector to
  bypass the review queue. No hot reload; deployment builds a Docker image.

## Checks and production releases

- GitHub CI runs when a draft PR is marked ready, and on `main` releases.
  Before requesting CI, finish the batch of edits. To check a new revision,
  `gh pr ready --undo` then `gh pr ready`; rerunning an old run checks old code.
  Keep unchanged passing checks. Required `checks` and up-to-date protection stay.
- Merge/push to `main` only with explicit user authorization. Before that merge,
  update the branch against current `main`, replace the entire changelog in
  `client/src/pages/InfoPage.tsx` with the release date and a few short lines,
  push, then request final CI. Production deploys after successful main checks;
  it does not reset dev. Never run `deploy/update.sh` unless asked.
- After a merge, pull production `main` under the Git fetch lock, then call
  `./deploy/dev-review.sh release MERGED_BRANCH` (advances its queued successor
  only if it owned dev), remove your worktree, and delete local/remote branches.
  Release before removing the worktree so its script remains available.

## Resources and secrets

- Start with three active sessions and one heavy job. `tools/agent-session.sh`
  queues new sessions and caps their shared memory when used as the launcher.
  T3 must actually launch through it; repo instructions cannot limit independently
  opened chats. See `docs/agent-workflow.md`. Never kill another agent to free RAM.
- Use development credentials/data only. Never print/commit `.env*`, Clerk
  secrets, or Tunnel credentials. Copy ignored `.env.dev` from the dev checkout
  if present, otherwise the production checkout's **dev** env file; never `.env`.
