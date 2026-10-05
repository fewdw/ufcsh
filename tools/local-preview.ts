import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, constants, cpSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const stateDir = path.join(root, ".local-preview");
const stateFile = path.join(stateDir, "state.json");

export function previewIdentity(worktree: string) {
  const id = createHash("sha256").update(worktree).digest("hex").slice(0, 12);
  const tsPort = 10000 + parseInt(id.slice(0, 8), 16) % 2000;
  return { unit: `ufcsh-preview-${id}`, tsPort, apiPort: tsPort + 10000, clientPort: tsPort + 20000 };
}

export function previewEnvironments(dev: NodeJS.ProcessEnv, origin: string, worktree: string) {
  for (const [key, prefix] of [["DEV_CLERK_PUBLISHABLE_KEY", "pk_test_"], ["DEV_CLERK_SECRET_KEY", "sk_test_"]]) {
    if (dev[key] && !dev[key].startsWith(prefix)) throw new Error(`${key} must use Clerk development credentials.`);
  }
  const { apiPort, clientPort } = previewIdentity(worktree);
  return {
    api: {
      NODE_ENV: "development", HOST: "127.0.0.1", PORT: String(apiPort),
      DATA_DIR: path.join(worktree, ".local-preview", "data"), API_WORKERS: "0", SYNC_MODE: "inline",
      NO_SYNC: dev.TS_NO_SYNC ?? "1", DISABLE_REPAIRS: "1", METRICS_PORT: "0", TRUSTED_PROXY_IPS: "",
      SITE_ORIGIN: origin, CLERK_AUTHORIZED_PARTIES: `${origin},http://localhost:${clientPort},http://127.0.0.1:${clientPort}`,
      ADMIN_TOKEN: dev.DEV_ADMIN_TOKEN ?? "", DEFAULT_ADMIN: dev.DEV_DEFAULT_ADMIN ?? "",
      CLERK_PUBLISHABLE_KEY: dev.DEV_CLERK_PUBLISHABLE_KEY ?? "", CLERK_SECRET_KEY: dev.DEV_CLERK_SECRET_KEY ?? "",
      CLERK_PROXY_URL: "", GEMINI_API_KEY: dev.DEV_GEMINI_API_KEY ?? "",
    },
    client: {
      NODE_ENV: "development", VITE_CLERK_PUBLISHABLE_KEY: dev.DEV_CLERK_PUBLISHABLE_KEY ?? "",
      VITE_CLERK_PROXY_URL: "", VITE_SITE_ORIGIN: origin, UFC_PREVIEW_API_PORT: String(apiPort),
      UFC_PREVIEW_ORIGIN: origin,
    },
  };
}

function command(name: string, args: string[]) {
  return execFileSync(name, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 }).trim();
}

function devConfig(explicitFile?: string) {
  // Resolve the original clone through Git so this also works in nested worktrees.
  const common = path.resolve(root, command("git", ["rev-parse", "--git-common-dir"]));
  const requested = explicitFile || process.env.UFC_DEV_ENV_FILE;
  if (requested && !existsSync(requested)) throw new Error("The requested development env file does not exist.");
  const candidates = [requested, path.join(root, ".env.dev"), path.join(path.dirname(common), ".env.dev")];
  const file = candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
  if (!file) throw new Error("Create a private .env.dev with development credentials (see docs/local-development.md).");
  if (existsSync(path.join(root, ".env.local"))) throw new Error("Remove .env.local from this worktree; local previews use .env.dev only.");
  return { file: path.resolve(file), values: parseEnv(readFileSync(file, "utf8")) };
}

// Do not inherit production app credentials or arbitrary VITE_* variables.
function baseEnvironment() {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "TZ", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

export async function assertPortFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", () => reject(new Error(`Port ${port} is occupied; leave its owner running and use another worktree.`)));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
}

export async function seedData(source: string, destination: string) {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  if (existsSync(path.join(destination, "ufc.db"))) return;
  const pending: string[] = [];
  for (const name of ["scoring.db", "ufc.db"]) {
    const file = path.join(source, name);
    if (!existsSync(file)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    const target = path.join(destination, name);
    try { await backup(db, `${target}.tmp`); } finally { db.close(); }
    chmodSync(`${target}.tmp`, 0o600);
    pending.push(target);
  }
  if (existsSync(path.join(source, "images"))) {
    cpSync(path.join(source, "images"), path.join(destination, "images"), { recursive: true, mode: constants.COPYFILE_FICLONE });
  }
  // Publish ufc.db last: an interrupted seed can be retried before any API starts.
  for (const target of pending) renameSync(`${target}.tmp`, target);
}

async function installDependencies() {
  for (const project of ["server", "client"]) {
    const lock = path.join(root, project, "package-lock.json");
    const manifest = path.join(root, project, "package.json");
    const installed = path.join(root, project, "node_modules", ".package-lock.json");
    const stamp = path.join(stateDir, `${project}-dependencies.sha256`);
    const hash = createHash("sha256").update(readFileSync(lock)).update(readFileSync(manifest)).digest("hex");
    const matches = existsSync(stamp) ? readFileSync(stamp, "utf8") === hash :
      existsSync(installed) && Math.max(statSync(lock).mtimeMs, statSync(manifest).mtimeMs) <= statSync(installed).mtimeMs;
    if (existsSync(installed) && matches) { writeFileSync(stamp, hash); continue; }
    console.log(`Installing ${project} dependencies…`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(path.join(root, "tools/heavy.sh"), ["npm", "ci", "--include=dev", "--prefix", project], { cwd: root, env: baseEnvironment(), stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${project} dependency installation failed.`)));
    });
    writeFileSync(stamp, hash);
  }
}

type State = ReturnType<typeof previewIdentity> & { origin: string; mode: string; envFile: string };
function readState(): State | undefined { return existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : undefined; }
function active(unit: string) { try { return command("systemctl", ["--user", "is-active", `${unit}.service`]) === "active"; } catch { return false; } }
function serveConfig() { return JSON.parse(command("tailscale", ["serve", "status", "--json"])); }

type ServeConfig = { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; TCP?: Record<string, unknown>; AllowFunnel?: Record<string, boolean> };
export function assertServeOwnership(config: ServeConfig, state: Pick<State, "origin" | "tsPort" | "clientPort">, allowEmpty = false) {
  const key = `${new URL(state.origin).hostname}:${state.tsPort}`;
  const entry = config.Web?.[key];
  if (config.AllowFunnel?.[key]) throw new Error("This preview port has public Funnel enabled; disable it before starting.");
  if (entry && (Object.keys(entry.Handlers ?? {}).length !== 1 || entry.Handlers?.["/"]?.Proxy !== `http://127.0.0.1:${state.clientPort}`)) {
    throw new Error("This Tailscale port belongs to another service; leave it running and use another worktree.");
  }
  if (!entry && (config.TCP?.[state.tsPort] || !allowEmpty)) throw new Error("Tailscale Serve does not point to this preview.");
}

async function ready(origin: string) {
  for (const pathname of ["/readyz", "/"]) {
    const response = await fetch(origin + pathname, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Preview ${pathname} returned ${response.status}.`);
    if (pathname === "/" && !(await response.text()).includes("/@vite/client")) throw new Error("Preview did not return the Vite frontend.");
  }
}

async function runWorker(origin: string, envFile: string) {
  const { api, client } = previewEnvironments(devConfig(envFile).values, origin, root);
  const { clientPort } = previewIdentity(root);
  const children = [
    spawn(process.execPath, ["--watch", "server/src/index.ts"], { cwd: root, env: { ...baseEnvironment(), ...api }, stdio: "inherit" }),
    spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(clientPort), "--strictPort"], { cwd: path.join(root, "client"), env: { ...baseEnvironment(), ...client }, stdio: "inherit" }),
  ];
  let stopping = false;
  const stop = () => { if (!stopping) { stopping = true; for (const child of children) child.kill("SIGTERM"); } };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  await Promise.all(children.map(child => new Promise<void>((resolve, reject) => {
    child.once("error", err => { stop(); reject(err); });
    child.once("exit", code => { stop(); code && code !== 0 ? reject(new Error(`Preview process exited with ${code}.`)) : resolve(); });
  })));
}

async function main() {
  const action = process.argv[2] ?? "local";
  if (action === "--run") { await runWorker(process.argv[3], process.argv[4]); return; }
  if (!["local", "ts", "status", "stop"].includes(action)) throw new Error("Usage: ./start [ts|local|status|stop]");
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const old = readState();
  if (action === "stop") {
    if (!old) { console.log("No preview for this worktree."); return; }
    if (old.mode === "ts") {
      const config = serveConfig();
      assertServeOwnership(config, old, true);
      if (config.Web?.[`${new URL(old.origin).hostname}:${old.tsPort}`]) command("tailscale", ["serve", "--bg", `--https=${old.tsPort}`, "off"]);
    }
    if (active(old.unit)) command("systemctl", ["--user", "stop", `${old.unit}.service`]);
    console.log("Stopped this worktree's preview; its data is retained."); return;
  }
  if (action === "status") {
    if (!old || !active(old.unit)) throw new Error("This worktree's preview is stopped. Run ./start ts.");
    if (old.mode === "ts") assertServeOwnership(serveConfig(), old);
    await ready(old.origin); console.log(`Ready: ${old.origin}`); return;
  }
  if (old && active(old.unit)) {
    if (old.mode !== action) throw new Error("Stop this worktree's current preview before changing modes.");
    if (action === "ts") assertServeOwnership(serveConfig(), old);
    await ready(old.origin); console.log(`Ready: ${old.origin}`); return;
  }
  const identity = previewIdentity(root);
  let origin = `http://127.0.0.1:${identity.clientPort}`;
  if (action === "ts") {
    const status = JSON.parse(command("tailscale", ["status", "--json"]));
    const hostname = status.Self?.DNSName?.replace(/\.$/, "");
    if (status.BackendState !== "Running" || !hostname) throw new Error("Connect this machine to Tailscale before running ./start ts.");
    origin = `https://${hostname}:${identity.tsPort}`;
  }
  const dev = devConfig();
  const state = { ...identity, origin, mode: action, envFile: dev.file };
  previewEnvironments(dev.values, origin, root);
  if (action === "ts") assertServeOwnership(serveConfig(), state, true);
  command("systemctl", ["--user", "show-environment"]);
  await assertPortFree(identity.apiPort); await assertPortFree(identity.clientPort);
  await installDependencies();
  await seedData(dev.values.TS_SEED_DIR || path.join(homedir(), ".local/share/ufcsh/dev-seed"), path.join(stateDir, "data"));
  if (!existsSync(path.join(stateDir, "data", "ufc.db"))) console.log("No archive seed found; this preview starts with an empty database. See docs/local-development.md.");
  mkdirSync(path.join(stateDir, "vite-env"), { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  try { command("systemctl", ["--user", "reset-failed", `${state.unit}.service`]); } catch { /* First start. */ }
  command("systemd-run", ["--user", `--unit=${state.unit}`, "--collect", "--property=KillMode=control-group", "--property=TimeoutStopSec=15", "--property=MemoryMax=2G", `--working-directory=${root}`, process.execPath, path.join(root, "tools/local-preview.ts"), "--run", origin, dev.file]);
  try {
    const deadline = Date.now() + 60_000;
    while (true) {
      if (!active(state.unit)) throw new Error("Preview service stopped before becoming ready.");
      try { await ready(`http://127.0.0.1:${identity.clientPort}`); break; } catch { if (Date.now() >= deadline) throw new Error("Preview readiness timed out."); }
      await delay(250);
    }
    if (action === "ts") {
      command("tailscale", ["serve", "--bg", `--https=${identity.tsPort}`, `http://127.0.0.1:${identity.clientPort}`]);
      assertServeOwnership(serveConfig(), state);
      await ready(origin);
    }
    console.log(`Ready: ${origin}\nHot reload is active. ./start status checks it; ./start stop stops this worktree.\nLogs: journalctl --user -u ${state.unit} -n 50 --no-pager`);
  } catch (err) {
    command("systemctl", ["--user", "stop", `${state.unit}.service`]);
    throw new Error(`${(err as Error).message} Logs: journalctl --user -u ${state.unit} -n 50 --no-pager`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error((err as Error).message); process.exitCode = 1; });
}
