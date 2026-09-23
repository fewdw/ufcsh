# Development workflow

## Feature work

When asked to implement or “code up” a feature, create/use a feature branch in the sibling worktree `/home/ubuntu/ufcsh-dev`; never commit or push feature work directly to `main`. Keep `/home/ubuntu/ufcsh` on a clean `main` because automated production deployments pull there. Make the code change in the dev worktree, then run `/home/ubuntu/ufcsh/dev.sh`. This builds that worktree and updates `https://dev.ufc.sh`. Confirm that the dev app is healthy before reporting the work complete, and tell the user to reload the dev site to review it.

The dev environment uses its own Docker Compose service, data volume, Clerk keys, and Cloudflare Tunnel. Keep feature work and verification on dev; do not deploy production as part of an ordinary feature request.

## Production releases

Production is `https://ufc.sh`. Every successful CI run for a push or merge to `main` automatically deploys the new main branch to production. Therefore, merging or pushing to `main` is a production release: do it only when the user explicitly asks. For a manual recovery deployment, run `./deploy/update.sh` from the clean production checkout on `main`.

## Secrets and data

- Never commit, print, or share `.env`, `.env.dev`, Clerk secret keys, or Cloudflare Tunnel credentials.
- Use the development credentials and development data volume when working on dev.
- Do not point dev at the production database or modify production data during feature development.
- `.env.dev.example` is a template; actual local credentials belong in the ignored `.env.dev` file.

## Rebuild behavior

The dev app runs from a Docker image; code changes are not live through host-based hot reload. Run `/home/ubuntu/ufcsh/dev.sh` after making changes so the dev image is rebuilt from the active dev worktree. To switch the branch shown at `dev.ufc.sh`, use `./deploy/select-dev-branch.sh BRANCH` from the production checkout or the **Choose dev branch** GitHub Action; commit or stash changes in the dev worktree before switching.
