import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertPortFree, assertServeOwnership, previewEnvironments, previewIdentity, seedData } from "./local-preview.ts";

const worktree = "/tasks/feature";
const identity = previewIdentity(worktree);
const origin = `https://preview.example.ts.net:${identity.tsPort}`;
const state = { ...identity, origin };
const serveKey = `preview.example.ts.net:${identity.tsPort}`;
const handler = { Handlers: { "/": { Proxy: `http://127.0.0.1:${identity.clientPort}` } } };

test("development env maps credentials, isolates data, and keeps secrets out of Vite", () => {
  const env = previewEnvironments({
    DEV_CLERK_PUBLISHABLE_KEY: "pk_test_preview", DEV_CLERK_SECRET_KEY: "sk_test_preview",
    DEV_ADMIN_TOKEN: "private-admin", DEV_DEFAULT_ADMIN: "dev@example.test", DEV_GEMINI_API_KEY: "private-gemini",
    DEV_TUNNEL_TOKEN: "private-tunnel", CLERK_SECRET_KEY: "sk_live_inherited", VITE_SECRET: "private-secret",
    DATA_DIR: "/production", DEV_NO_SYNC: "0",
  }, origin, worktree);
  assert.equal(env.api.CLERK_SECRET_KEY, "sk_test_preview");
  assert.equal(env.api.ADMIN_TOKEN, "private-admin");
  assert.equal(env.api.DATA_DIR, "/tasks/feature/.local-preview/data");
  assert.equal(env.api.HOST, "127.0.0.1");
  assert.equal(env.api.NO_SYNC, "1");
  assert.equal(env.api.DISABLE_REPAIRS, "1");
  assert.ok(env.api.CLERK_AUTHORIZED_PARTIES.split(",").includes(origin));
  assert.equal(env.client.VITE_CLERK_PUBLISHABLE_KEY, "pk_test_preview");
  assert.equal(env.client.VITE_SITE_ORIGIN, origin);
  assert.doesNotMatch(JSON.stringify(env.client), /private-|sk_test|sk_live|production/);
  assert.equal(previewEnvironments({ TS_NO_SYNC: "0" }, origin, worktree).api.NO_SYNC, "0");
  const second = previewEnvironments({}, origin, "/tasks/second");
  assert.notEqual(second.api.DATA_DIR, env.api.DATA_DIR);
  assert.notEqual(second.api.PORT, env.api.PORT);
});

test("live Clerk credentials are refused before starting a preview", () => {
  assert.throws(() => previewEnvironments({ DEV_CLERK_SECRET_KEY: "sk_live_secret" }, origin, worktree), /development credentials/);
  assert.throws(() => previewEnvironments({ DEV_CLERK_PUBLISHABLE_KEY: "pk_live_public" }, origin, worktree), /development credentials/);
});

test("Serve ownership rejects public Funnel and unrelated routes without resetting anything", () => {
  const config = { Web: { [serveKey]: handler, "other.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } } } } };
  const before = JSON.stringify(config);
  assertServeOwnership(config, state);
  assert.equal(JSON.stringify(config), before);
  assertServeOwnership({}, state, true);
  assert.throws(() => assertServeOwnership({}, state), /does not point/);
  assert.throws(() => assertServeOwnership({ ...config, AllowFunnel: { [serveKey]: true } }, state), /public Funnel/);
  assert.throws(() => assertServeOwnership({ Web: { [serveKey]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } } }, state), /another service/);
  assert.throws(() => assertServeOwnership({ Web: { [serveKey]: { Handlers: { ...handler.Handlers, "/other": { Proxy: "http://127.0.0.1:3773" } } } } }, state), /another service/);
  assert.throws(() => assertServeOwnership({ TCP: { [state.tsPort]: { TCPForward: "127.0.0.1:3773" } } }, state, true), /does not point/);
});

test("occupied ports fail without terminating their listener", async () => {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  try {
    await assert.rejects(assertPortFree(address.port), /occupied/);
    assert.ok(listener.listening);
  } finally { await new Promise<void>(resolve => listener.close(() => resolve())); }
  await assertPortFree(address.port);
});

test("SQLite seeding includes live WAL data, isolates writes, and preserves an existing preview", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ufcsh-preview-test-"));
  const source = path.join(directory, "seed");
  const destination = path.join(directory, "worktree", "data");
  mkdirSync(source); mkdirSync(path.join(source, "images"));
  const db = new DatabaseSync(path.join(source, "ufc.db"));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE data(value TEXT); INSERT INTO data VALUES ('from WAL')");
  writeFileSync(path.join(source, "images", "fighter.webp"), "image");
  try {
    await seedData(source, destination);
    const preview = new DatabaseSync(path.join(destination, "ufc.db"));
    assert.equal(preview.prepare("SELECT value FROM data").get()?.value, "from WAL");
    preview.exec("UPDATE data SET value='local edit'");
    preview.close();
    assert.equal(db.prepare("SELECT value FROM data").get()?.value, "from WAL");
    writeFileSync(path.join(destination, "images", "fighter.webp"), "local image");
    assert.equal(readFileSync(path.join(source, "images", "fighter.webp"), "utf8"), "image");
    await seedData(source, destination);
    const retained = new DatabaseSync(path.join(destination, "ufc.db"));
    assert.equal(retained.prepare("SELECT value FROM data").get()?.value, "local edit");
    retained.close();
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("new-task creates a branch from origin/main without editing another checkout", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ufcsh-new-task-test-"));
  try {
    const repo = path.join(directory, "clone");
    const remote = path.join(directory, "origin.git");
    mkdirSync(repo); mkdirSync(path.join(repo, "tools"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-b", "main");
    git("-c", "user.name=Preview test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "baseline");
    git("init", "--bare", remote);
    git("remote", "add", "origin", remote); git("push", "origin", "main");
    writeFileSync(path.join(repo, "tools", "new-task.sh"), readFileSync(new URL("./new-task.sh", import.meta.url)), { mode: 0o755 });
    writeFileSync(path.join(repo, "untouched"), "existing local work");
    const before = git("status", "--porcelain");
    const env = { ...process.env, UFC_GIT_LOCK: path.join(directory, "fetch.lock") };
    const result = execFileSync("bash", [path.join(repo, "tools", "new-task.sh"), "feat/example"], { cwd: repo, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const task = path.join(directory, "ufcsh-wt", "example");
    assert.ok(result.includes(task));
    assert.equal(git("status", "--porcelain"), before);
    assert.equal(git("branch", "--show-current"), "main");
    assert.equal(git("-C", task, "branch", "--show-current"), "feat/example");
    assert.equal(git("-C", task, "rev-parse", "HEAD"), git("rev-parse", "origin/main"));
    assert.throws(() => execFileSync("bash", [path.join(repo, "tools", "new-task.sh"), "feat/../unsafe"], { env, stdio: "pipe" }));
    assert.throws(() => execFileSync("bash", [path.join(repo, "tools", "new-task.sh"), "feat/example"], { env, stdio: "pipe" }));
    assert.equal(git("status", "--porcelain"), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("stopping twice removes only this preview once and never stops an unrelated Serve owner", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "ufcsh-preview-stop-test-"));
  try {
    mkdirSync(path.join(directory, "tools")); mkdirSync(path.join(directory, "bin"));
    mkdirSync(path.join(directory, ".local-preview"));
    const script = path.join(directory, "tools", "local-preview.ts");
    writeFileSync(script, readFileSync(new URL("./local-preview.ts", import.meta.url)));
    const state = { ...previewIdentity(directory), origin, mode: "ts", envFile: "unused" };
    const key = `${new URL(origin).hostname}:${state.tsPort}`;
    const config = { Web: { [key]: { Handlers: { "/": { Proxy: `http://127.0.0.1:${state.clientPort}` } } } } };
    const stateFile = path.join(directory, ".local-preview", "state.json");
    const configFile = path.join(directory, "config.json");
    const activeFile = path.join(directory, "active");
    const callsFile = path.join(directory, "calls");
    writeFileSync(stateFile, JSON.stringify(state)); writeFileSync(configFile, JSON.stringify(config));
    writeFileSync(activeFile, "active"); writeFileSync(callsFile, "");
    writeFileSync(path.join(directory, "bin", "tailscale"), `#!/usr/bin/env bash
set -e
if [[ "$2" == status ]]; then cat "$TEST_CONFIG"; exit; fi
[[ "$*" == "serve --bg --https=$TEST_PORT off" ]]
printf 'serve off\\n' >> "$TEST_CALLS"
printf '{}' > "$TEST_CONFIG"
`, { mode: 0o755 });
    writeFileSync(path.join(directory, "bin", "systemctl"), `#!/usr/bin/env bash
set -e
if [[ "$2" == is-active ]]; then [[ -f "$TEST_ACTIVE" ]] || exit 3; echo active; exit; fi
[[ "$2" == stop ]]
printf 'service stop\\n' >> "$TEST_CALLS"
rm "$TEST_ACTIVE"
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${path.join(directory, "bin")}:${process.env.PATH}`,
      TEST_CONFIG: configFile, TEST_ACTIVE: activeFile, TEST_CALLS: callsFile, TEST_PORT: String(state.tsPort) };
    for (let i = 0; i < 2; i++) execFileSync(process.execPath, [script, "stop"], { env, stdio: "pipe" });
    assert.equal(readFileSync(callsFile, "utf8"), "serve off\nservice stop\n");
    writeFileSync(activeFile, "active");
    writeFileSync(configFile, JSON.stringify({ Web: { [key]: { Handlers: { "/": { Proxy: "http://127.0.0.1:3773" } } } } }));
    assert.throws(() => execFileSync(process.execPath, [script, "stop"], { env, stdio: "pipe" }));
    assert.equal(readFileSync(activeFile, "utf8"), "active");
    assert.equal(readFileSync(callsFile, "utf8"), "serve off\nservice stop\n");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
