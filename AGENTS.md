# Development workflow

## Feature work

When asked to implement or “code up” a feature, create/use a feature branch; never commit or push feature work directly to `main`. Make the code change and then run `./dev.sh` from the repository root. This builds and updates the development app at `https://dev.ufc.sh`. Confirm that the dev app is healthy before reporting the work complete, and tell the user to reload the dev site to review it.

The dev environment uses its own Docker Compose service, data volume, Clerk keys, and Cloudflare Tunnel. Keep feature work and verification on dev; do not deploy production as part of an ordinary feature request.

## Production releases

Production is `https://ufc.sh`. Deploy to it only when the user explicitly requests a production release. The production deployment command is `./deploy/update.sh`; follow the repository’s release process and make sure the intended changes are on `main` before using it.

## Secrets and data

- Never commit, print, or share `.env`, `.env.dev`, Clerk secret keys, or Cloudflare Tunnel credentials.
- Use the development credentials and development data volume when working on dev.
- Do not point dev at the production database or modify production data during feature development.
- `.env.dev.example` is a template; actual local credentials belong in the ignored `.env.dev` file.

## Rebuild behavior

The dev app runs from a Docker image; code changes are not live through host-based hot reload. Run `./dev.sh` after making changes so the dev image is rebuilt and the running dev app is updated.
