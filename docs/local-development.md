# Fast local previews

Features are built on the home server and reviewed on private Tailscale URLs.
`dev.ufc.sh` on the VPS is a separate Docker environment, used only on request
(see [the dev environment guide](dev-environment.md)).

## Daily use

```sh
./tools/new-task.sh feat/example   # branch + worktree ../ufcsh-wt/example from origin/main
cd ../ufcsh-wt/example
./start                            # prints https://HOST.TAILNET.ts.net:PORT
```

`./start` runs the API with Node watch and the client with Vite, so frontend and
API edits hot reload on the same URL. There is no client build, Docker image, or CI
wait. Running it again prints the same URL. `./start stop` stops this worktree's
preview and keeps its data; `./start logs` shows recent output.

Each worktree gets the next free port from 5101 (API on port + 1000) and its own
copy of the archive in ignored `.local-preview/data`, so any number of previews can
be open at once without sharing writes. Delete `.local-preview/data` while stopped
to reseed. Previews run as user systemd services (`ufcsh-WORKTREE`, 2 GiB cap) and
outlive the shell or agent that started them; run `./start` again after a reboot.

Without Tailscale the same command prints a `http://127.0.0.1:PORT` URL.

## One-time host setup

- Node 26+, npm, `jq`, `curl`, user systemd (with linger), and Tailscale connected
  with HTTPS enabled for the tailnet. Your laptop/phone must be on the same tailnet.
- Development credentials in the main clone's ignored `.env.dev` (mode 600); a
  worktree's own `.env.dev` takes precedence. Copy the VPS **dev** env file, never
  production `.env`. The launcher maps `DEV_ADMIN_TOKEN`, `DEV_DEFAULT_ADMIN`,
  `DEV_CLERK_*`, and `DEV_GEMINI_API_KEY`, and refuses live Clerk keys.
- An archive seed in `~/.local/share/ufcsh/dev-seed` (or `TS_SEED_DIR`): `ufc.db`,
  `scoring.db`, and `images/` taken from the VPS **dev** volume with SQLite's backup
  command, not a raw copy of a live database. Without a seed the preview starts empty.

Sync is off by default so branches don't all scrape upstream; set `TS_NO_SYNC=0`
in `.env.dev` and restart the preview when a task needs it.

## Privacy

Tailscale Serve shares only inside the tailnet; never enable Funnel. The API and
Vite listen on `127.0.0.1`, and Vite accepts only `*.ts.net` and localhost hosts
and serves files from `client/` only. Tailnet access is separate from Clerk sign-in.
