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

The dev app runs from a Docker image; code changes are not live through host-based hot reload. Run `/home/ubuntu/ufcsh/dev.sh` after making changes so the dev image is rebuilt from the active dev worktree. Every push to a branch other than `main` automatically deploys that branch to `dev.ufc.sh`. To switch the branch shown at `dev.ufc.sh` by hand, use `./deploy/select-dev-branch.sh BRANCH` from the production checkout or the **Choose dev branch** GitHub Action; commit or stash changes in the dev worktree before switching.

## Working in the code

- Start from `docs/project-map.md` to find the file that owns a feature.
- Checks before a push: `npm test --prefix client`, `server/node_modules/.bin/tsc --noEmit -p server/tsconfig.json`, `npm run lint --prefix client`, `npm run build --prefix client`. The full server suite needs the archive: `DATA_DIR=<copy of data> npm test --prefix server`.
- Data-quality gaps a feature can leave behind belong on the admin Bugs board (`server/src/bugs.ts`) with a repair action where one exists.
- Measure before optimising; record results in `docs/performance.md`.
