# VPS dev review and resource limits

Task, preview, CI and merge rules are in `AGENTS.md`; local previews are in
[local development](local-development.md). This page covers what those leave out.

## VPS dev review (only when asked)

Run on the VPS in `/home/ubuntu/ufcsh-dev` (from the home server, through
`ssh ufcsh-vps`); never run the selector against the local clone.

| Request | Command |
| --- | --- |
| Task finished, queue it for dev | `./deploy/dev-review.sh ready BRANCH FULL_PUSHED_SHA` |
| Put this task in dev | `./deploy/dev-review.sh priority BRANCH SHA` |
| Don't deploy this task | `./deploy/dev-review.sh skip BRANCH` |
| Show the next finished task | `./deploy/dev-review.sh next` |
| Release the current task / it was merged | `./deploy/dev-review.sh release BRANCH` |
| What's on dev / waiting? | `./deploy/dev-review.sh status` |

- The first `ready` task deploys; later ones wait in a FIFO queue without polling.
  The owner keeps dev until it is merged, released, or explicitly replaced.
- `priority` keeps the previous task at the front of the queue.
- `release` advances the queue only when the named branch owned dev. With nothing
  waiting, the container keeps running and the slot is free. Don't release a live
  review merely because the chat ended.
- A production deploy also advances the queue when the owner's commit is in the
  released `main`, so merges made on GitHub need no manual release.
- A failed or killed deploy keeps the slot with a `failed`/`deploying` status;
  retry the owner or use `priority`/`next`.
- Requests pin the pushed SHA, and the selector verifies the running container's
  revision and health itself. No browser is needed for that.

## Resource limits

- `./tools/heavy.sh COMMAND ...`: one job across all worktrees, waits up to ten
  minutes for 2.5 GiB available memory, runs capped at 2 GiB RAM and 512 MiB swap.
- `deploy/build.sh` builds in its own BuildKit container (`ufcsh-bounded`, 2 GiB,
  two cores); dev runs under the same cap (`DEV_MEMORY_LIMIT`/`DEV_CPU_LIMIT`).
- `./tools/agent-session.sh codex` is an optional launcher that allows three
  sessions in one 2 GiB slice. Chats that T3 launches directly bypass it, so keep
  to about three active chats by hand.

Measured numbers are in [performance](performance.md).
