# Private dev environment

`https://dev.ufc.sh` runs from a separate Git worktree in a separate app container and
database volume. A Cloudflare Tunnel connects to that container over a private
Docker network. The dev app publishes no host port and is not routed through
the production Caddy server. Cloudflare Access allows only the people you list.

## Why this setup

Cloudflare Tunnel plus Access gives the requested HTTPS hostname without
opening a new origin port. The tunnel can also validate the Access token before
forwarding requests to dev. Production keeps its existing Caddy route and
deploys automatically after a successful CI run on `main`.

Tailscale is useful if every device can join your tailnet, but its normal HTTPS
hostname is under `*.ts.net`; using `dev.ufc.sh` would need extra DNS and client
configuration. A direct Cloudflare-proxied DNS record plus Access is simpler to
route, but the production server's public IP would need additional origin
authentication to prevent bypassing Access. Tunnel isolates the dev origin.

## One-time setup

1. In Cloudflare **Zero Trust → Access controls → Applications**, create a
   **Self-hosted** application for the entire public hostname `dev.ufc.sh`.
   Add an **Allow** policy for your exact email address. Email one-time PIN is
   enough; you can choose Google if you have it configured in Cloudflare.
   Add another email to this policy when you want to share dev.
2. In **Networking → Tunnels**, create a remotely managed tunnel called
   `ufcsh-dev`. Add a **published application route** for `dev.ufc.sh` with
   service URL `http://app-dev:8000`. Enable **Protect with Access** for this
   route and select the Access application created above. Cloudflare normally
   creates the tunnel DNS record automatically when you publish the route.
   Do not make an A record pointing `dev` at the server's public IP.
3. Copy the tunnel token from the dashboard's Docker installation command.
   Copy only the token; the `dev-tunnel` Compose service runs cloudflared for
   you. Keep this token private because it lets a connector join the tunnel.
4. In Clerk, select this application's **Development** instance or create a
   separate Clerk application if you want entirely separate settings. Use its
   `pk_test_...` and `sk_test_...` keys. Development instances use Clerk's
   hosted `*.clerk.accounts.dev` frontend API; do not set a Clerk proxy URL.
   Add `https://dev.ufc.sh` to allowed origins or redirect URLs if Clerk
   prompts for them. Configure Google or other social sign-in separately if
   you need to exercise those flows.
5. On the server, create the private env file:

   ```sh
   cp .env.dev.example .env.dev
   chmod 600 .env.dev
   openssl rand -hex 32
   nano .env.dev
   ```

   Set `DEV_DEFAULT_ADMIN` to your Clerk account email. Paste the random
   output into `DEV_ADMIN_TOKEN`, then fill in the Clerk development keys and
   `DEV_TUNNEL_TOKEN`. `.env.dev` stays on this server and is ignored by Git.
6. Run `./dev.sh`, then open `https://dev.ufc.sh`. The first start creates a
   separate database and begins background data sync/backfill.

The `pk_live_...` and `sk_live_...` pair shared in chat are production-format
credentials. Do not use them for dev. Rotate the live secret in Clerk because
it was shared in the conversation.

## Daily workflow

The production checkout is `/home/ubuntu/ufcsh` and stays on `main`. The dev
worktree is `/home/ubuntu/ufcsh-dev`. Every push to a branch other than
`main` deploys that branch to `dev.ufc.sh` automatically (the `deploy-dev` job
in CI), without waiting for the checks. A push or merge to `main` deploys
production and then moves dev onto `main` as well (the `sync-dev` job), so the
two match until the next branch push. To show a different pushed branch by
hand, run
`./deploy/select-dev-branch.sh BRANCH` from the production checkout. Or in
GitHub, open **Actions → Choose dev branch → Run workflow**, leave the workflow
ref on `main`, and type the branch name. This fetches the branch, switches the
dev worktree, rebuilds the app, and updates `dev.ufc.sh`. The worktree must be
clean before switching branches; commit or stash unfinished changes first.

Edit code in the dev worktree and run `/home/ubuntu/ufcsh/dev.sh` to rebuild
and restart dev from those changes. The browser updates after the build
finishes. Follow startup with:

```sh
cd /home/ubuntu/ufcsh
docker compose -p ufcsh --env-file .env.dev -f compose.dev.yaml logs -f app-dev dev-tunnel
```

When satisfied, commit and push your branch and open a PR. The push shows
the branch at `dev.ufc.sh`, and the CI checks run on it. Once the PR reaches `main` and CI succeeds there, GitHub
Actions deploys production to `ufc.sh` automatically. Switching dev branches
never deploys production. `/home/ubuntu/ufcsh/deploy/update.sh` remains
available for manual recovery.

To stop dev while retaining its database, run:

```sh
cd /home/ubuntu/ufcsh
docker compose -p ufcsh --env-file .env.dev -f compose.dev.yaml stop dev-tunnel app-dev
```

Avoid `docker compose down -v` on this shared host: it can delete production
volumes. The dev database is in the separate `ufcsh_app-dev-data` volume.

## Access boundaries

- Cloudflare Access controls who can open the site. Clerk handles sign-in
  inside the app, with a separate development user directory.
- The tunnel route must keep **Protect with Access** enabled so cloudflared
  verifies the Access token before forwarding to the dev app.
- The dev app publishes no host port and has no production database mount.
- No Google Cloud firewall or production Caddy change is needed.
