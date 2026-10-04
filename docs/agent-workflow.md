# Agents, review, and resources

Each chat works in its own worktree. Pushing saves work; finishing a task submits
it for review. No feature push triggers CI or deployment.

## Dev review

From the task worktree, after the final push and appropriate verification:

```sh
./deploy/dev-review.sh ready feat/example FULL_PUSHED_SHA
```

The first finished task deploys. Others enter a FIFO queue and finish their chat
without polling. The current task keeps dev until it is merged, released, or
explicitly replaced. There is no timer that interrupts a review. Follow-up fixes
from the owner may update its deployment.

User intent takes precedence:

| Request | Command |
| --- | --- |
| Don't deploy this task | `./deploy/dev-review.sh skip BRANCH` |
| Put this task in dev | `./deploy/dev-review.sh priority BRANCH SHA` |
| Show the next finished task | `./deploy/dev-review.sh next` |
| Release the current task / it was merged | `./deploy/dev-review.sh release BRANCH` |
| What's on dev / waiting? | `./deploy/dev-review.sh status` |

A priority request preserves the previous task at the front of the queue. Release
advances the queue only when the named branch owned dev; merging another task
does not interrupt the review. With no waiting task, release leaves the current
container running but frees the slot. Selecting `main` explicitly also frees it.
Don't release a live review merely because the chat ended.

After a production deployment, the SSH handler checks whether the dev owner's
commit was merged into that checked main revision and advances its queue. This
also handles normal merges made directly on GitHub. Agent cleanup explicitly
releases its branch as well (including squash merges); both paths are idempotent.

State is private JSON under `~/.local/state/ufcsh/dev-review`; all calls hold the
same host deployment lock, including **Choose dev branch**. Deployment failures
retain the slot and a failed status, so another finisher cannot hide the failure.
Retry the owner or use priority/next explicitly. A killed deploy leaves a
`deploying` status; the same recovery commands apply. Requests pin the verified,
pushed SHA, not a branch tip that may change while waiting.

The selector checks running container labels, the baked image revision, and health, skips identical healthy
deployments, and checks readiness before reporting success. No browser is needed
for this verification. Keep the browser for layout/interaction checks.

## Explicit CI

Open draft PRs. Mark a completed batch ready to request CI (`gh pr ready`). A new
revision needs a fresh ready transition (`gh pr ready --undo`, then `gh pr ready`);
ordinary pushes don't rerun it. Required `checks` must still pass on the latest
revision, and the branch must include current main. Re-running an old Actions run
does not verify a newer commit.

Before an authorized merge, update against main and prepare the release changelog
in the same batch, then push and request final CI. Main CI still gates production.
Production releases leave the selected dev branch alone. Perform the owner's
release before deleting its worktree so the next ready branch can deploy.

## Bounded local work

Use `./tools/heavy.sh COMMAND ...` for installs, builds, TypeScript and full server
tests. One job runs across all worktrees; it waits for at least 2.5 GiB available
memory, up to ten minutes, without repeated log output. On this host, a user
systemd scope limits the command and descendants to 2 GiB RAM and 512 MiB swap.
Without user systemd it still queues and warns that the memory cap is unavailable.

Docker runs builds outside that command's process tree. `deploy/build.sh` therefore
uses its own BuildKit container (`ufcsh-bounded`), capped at 2 GiB, no swap, and two
CPU cores. It preserves cache without changing the default Docker builder. The
first build has a cold cache; later builds reuse it. Dev is capped at 2 GiB/two
cores by Compose; production runtime limits are unchanged. Peak measurements may
justify adjusting `DEV_MEMORY_LIMIT`/`DEV_CPU_LIMIT` in the ignored dev env file.
Dev images are tagged by commit so another build cannot replace a queued task's
image. Documentation/test-only changes no longer invalidate client builds.

Start with three active chats. For an agent launcher you control:

```sh
./tools/agent-session.sh codex
```

It waits before launching a fourth agent and places launched sessions in one
systemd slice with a 1.5 GiB soft threshold, 2 GiB hard limit, and 512 MiB swap.
The hard limit can terminate a development session; it cannot make unlimited
agents fit. Configure the T3 launcher to invoke this wrapper **if supported**;
the repository cannot intercept chats T3 launches directly. Without that
integration, keep the active-chat limit manually. Repo heavy commands and Docker
limits still work independently. No tools stop/kill other existing chats.

Resource settings are starting budgets, not a guarantee. Measure peaks with
`/usr/bin/time -v`, `docker stats`, and `free -h`. The server currently has 7.6 GiB
RAM/four cores and 4 GiB swap; swap is a buffer, not additional fast RAM. More
simultaneous heavy work needs more capacity or a separate development host.

## Adopting the change

The new workflow takes effect after this PR is merged. Update existing task
branches from main **before pushing**: old branch copies of CI can still launch
old workflows. The SSH handler rejects old unpinned `dev BRANCH` requests to
prevent them replacing a review. Existing chats must read the updated AGENTS.md.
On first use the coordinator preserves an existing feature review from container
labels (or the legacy deployment checkout). It marks this as `existing`, not as
verified healthy. A dev container on main leaves the slot free. Use priority/next
to replace an existing review explicitly; ambiguous legacy branches are shown as
`existing-review` until you select or release them.
