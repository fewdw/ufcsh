# Fast local development

The default feature workflow is local Node + Vite with a private Tailscale URL.
`ts` means Tailscale. `dev` means the existing Docker environment at
`https://dev.ufc.sh` on `ssh ufcsh-vps`; production and that environment keep their
existing deployment paths.

## Daily use

From the original clone:

```sh
./tools/new-task.sh feat/example
cd ../ufcsh-wt/example
# Build the feature and run the relevant checks.
./start ts
```

The new-task script fetches under the shared Git lock and branches from
`origin/main`. It never switches the original checkout. On this machine the clone
is `/home/fred/Projects/ufcsh` and tasks live under `/home/fred/Projects/ufcsh-wt`.
Each preview gets a stable `https://HOST.tailNET.ts.net:PORT` URL, its own API/client
ports, and its own database/image copy. Send the printed URL with the draft PR.
The script also works from an existing task; use its printed absolute worktree path.

`./start` (or `./start local`) gives a loopback URL without configuring Tailscale.
Both modes run as a user systemd service, so the preview survives the shell/agent
ending. `./start status` checks the frontend and API; `./start stop` removes only
this worktree's Tailscale listener and stops its service while retaining data.
Stop before switching modes or removing a worktree. Previews are not started
at boot; run the launcher again after a reboot. Follow-up edits use the same URL.

Vite serves source directly with hot reload; Node watch restarts the API on server
edits. The launcher does not build the client, use Docker, wait for CI, or redeploy
the VPS. Dependencies install once and reinstall when the package/lock files change.
The process group has a 2 GiB systemd memory cap; installs/checks use `tools/heavy.sh`.

## One-time host setup

This launcher targets a Linux development host with Node 26+, npm, Git, `flock`,
and a working user systemd manager. Tailscale is required only for `./start ts`.
On the configured host, Tailscale is connected and the user manager has linger
so services remain available after logout. Connect your Mac/phone to the same
tailnet and allow access to the development host in its tailnet policy.

Keep development credentials in the original clone's ignored `.env.dev` (mode
600). Worktrees read it without copying secrets into each checkout. A worktree's
own `.env.dev` takes precedence; `UFC_DEV_ENV_FILE=/absolute/private/file ./start ts`
can select another development file. Copy only the VPS **development** env file
when provisioning a new host; never production `.env`.

The launcher maps `DEV_ADMIN_TOKEN`, `DEV_DEFAULT_ADMIN`, the two `DEV_CLERK_*`
keys, and optional `DEV_GEMINI_API_KEY` to their API variables. It rejects live
Clerk keys. The browser receives only the development publishable key and site
origin. Clerk's authorized parties and site origin include the exact preview URL;
configure development sign-in/redirect settings in Clerk if that URL needs it.
Local `.env.local` is refused to prevent the server's legacy loader overriding
these settings. Vite uses a separate empty env directory for these previews.

The seed directory is `~/.local/share/ufcsh/dev-seed` (mode 700), outside Git.
It contains consistent SQLite backups of `ufc.db` and `scoring.db` and a copy of
`images/` from the VPS **development** volume `ufcsh_app-dev-data`. Use SQLite's
backup API against the running source; copying just a live `.db` can miss WAL data.
The source is read only. Never mount/write the VPS volumes into a local preview.
For another seed, set `TS_SEED_DIR=/absolute/private/archive` in `.env.dev`.

On a worktree's first start, SQLite backup copies the seed databases and copies
images (using filesystem reflinks where available) into ignored
`.local-preview/data`. Later starts retain that worktree's changes. No seed is
required for an empty app, but it will have no archive while sync is disabled.

Preview sync defaults off to avoid every branch launching scrapers and competing
for upstream requests. `TS_NO_SYNC=0` in `.env.dev` enables sync when needed;
restart that preview after changing env settings. `DEV_NO_SYNC` still controls
Docker dev and is not changed. Automated repair actions remain disabled by default.
Tests must use another disposable archive copy rather than the preview's data.

## Privacy and troubleshooting

[Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) shares
only within the tailnet; do not enable public Funnel. The launcher checks its own
Serve route, rejects an occupied port or public Funnel, and never resets other
listeners. A rare hashed-port collision needs a different worktree name.

The API and Vite listen on `127.0.0.1`, not LAN/public interfaces. Vite allows
only the exact preview hostname plus its localhost defaults; it keeps default
CORS restrictions and restricts file serving to `client/`. Its default sensitive
file deny rules remain enabled. See [Vite server options](https://vite.dev/config/server-options).
Secrets/data stay outside the client root and are ignored by Git. Tailnet access
is separate from Clerk sign-in inside the app.

If Tailscale asks you to enable HTTPS, complete its tailnet HTTPS setup and retry.
The launcher prints errors instead of falling back to a public binding. A failed
launch retains worktree data; stop/retry it after correcting the error.

The launcher prints the exact log command:

```sh
journalctl --user -u ufcsh-preview-ID -n 50 --no-pager
```

Use it for startup errors; `./start status` checks actual readiness. If env files,
package files, or the launcher change, stop and start the preview to apply them.
Normal frontend/server source edits hot reload automatically. If the laptop/phone
cannot reach the link, check its Tailscale connection and policy first. The host
must remain awake and connected.

Pushing/opening a draft PR saves the change without CI/deployment. Use the VPS
coordinator only for an explicit `dev` request; see [agent workflow](agent-workflow.md).
Production releases still require authorization and passing checks.
