import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const shaA = "a".repeat(40);
const shaB = "b".repeat(40);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ufcsh-agent-workflow-"));
  const deploy = path.join(root, "deploy");
  const bin = path.join(root, "bin");
  await mkdir(deploy);
  await mkdir(bin);
  for (const name of ["dev-review.sh", "dev-review.ts"]) {
    await copyFile(new URL(`../../deploy/${name}`, import.meta.url), path.join(deploy, name));
  }
  await writeFile(path.join(deploy, "select-dev-branch.sh"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s %s\\n' "$1" "$2" >> "$TEST_CALLS"
sleep 0.1
[[ "$1" != "\${TEST_FAIL_BRANCH:-}" ]]
`, { mode: 0o755 });
  // These fixtures never contact Docker, use real credentials, or touch shared locks.
  await writeFile(path.join(bin, "systemctl"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
  await writeFile(path.join(bin, "docker"), "#!/usr/bin/env bash\nexit 1\n", { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    UFC_REVIEW_STATE_DIR: path.join(root, "state"),
    UFC_DEV_LOCK: path.join(root, "dev.lock"),
    UFC_GIT_LOCK: path.join(root, "git.lock"),
    UFC_HEAVY_LOCK: path.join(root, "heavy.lock"),
    UFC_HEAVY_MIN_AVAILABLE_KB: "0",
    UFC_HEAVY_LOCK_HELD: "0",
    UFC_DEV_LOCK_HELD: "0",
    UFC_AGENT_SCOPE: "0",
    UFC_PRODUCTION_DIR: path.join(root, "no-production"),
    UFC_DEV_DIR: path.join(root, "no-dev"),
    UFC_AGENT_STATE_DIR: path.join(root, "slots"),
    UFC_AGENT_SLOTS: "1",
    TEST_CALLS: path.join(root, "calls"),
    TEST_SENTINEL: path.join(root, "sentinel"),
  };
  const run = (script: string, args: string[], extra: NodeJS.ProcessEnv = {}) => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn("bash", [script, ...args], { env: { ...env, ...extra } });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, output }));
  });
  return {
    root, env, run,
    review: (...args: string[]) => run(path.join(deploy, "dev-review.sh"), args),
    state: async () => JSON.parse(await readFile(path.join(root, "state", "state.json"), "utf8")),
    calls: async () => (await readFile(env.TEST_CALLS, "utf8")).trim().split("\n"),
    close: () => rm(root, { recursive: true, force: true }),
  };
}

test("separate chats race for dev: exactly one deploys, the other queues", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([f.review("ready", "feat/first", shaA), f.review("ready", "feat/second", shaB)]);
    for (const result of results) assert.equal(result.code, 0, result.output);
    const state = await f.state();
    assert.equal(state.owner.status, "healthy");
    assert.equal(state.queue.length, 1);
    assert.notEqual(state.owner.branch, state.queue[0].branch);
    assert.deepEqual(await f.calls(), [`${state.owner.branch} ${state.owner.sha}`]);
    assert.equal(results.filter(result => result.output.includes("Queued")).length, 1);
  } finally { await f.close(); }
});

test("explicit dev overrides ownership; opt-out removes a queued task; next preserves FIFO", async () => {
  const f = await fixture();
  try {
    await f.review("ready", "feat/first", shaA);
    await f.review("ready", "feat/second", shaA);
    await f.review("ready", "feat/third", shaA);
    await f.review("ready", "feat/second", shaB);
    assert.deepEqual((await f.state()).queue, [
      { branch: "feat/second", sha: shaB }, { branch: "feat/third", sha: shaA },
    ]);
    assert.equal((await f.review("priority", "feat/urgent", shaB)).code, 0);
    assert.equal((await f.state()).owner.branch, "feat/urgent");
    assert.equal((await f.state()).queue[0].branch, "feat/first");
    await f.review("skip", "feat/second");
    await f.review("next");
    assert.equal((await f.state()).owner.branch, "feat/first");
    await f.review("release", "feat/unrelated");
    assert.equal((await f.state()).owner.branch, "feat/first");
    await f.review("release", "feat/first");
    assert.equal((await f.state()).owner.branch, "feat/third");
    await f.review("release", "feat/third");
    assert.equal((await f.state()).owner, null);
    assert.deepEqual(await f.calls(), [
      `feat/first ${shaA}`, `feat/urgent ${shaB}`, `feat/first ${shaA}`, `feat/third ${shaA}`,
    ]);
  } finally { await f.close(); }
});

test("failed deployments retain ownership and can be retried without losing queued work", async () => {
  const f = await fixture();
  try {
    const failure = await f.run(path.join(f.root, "deploy", "dev-review.sh"), ["ready", "feat/first", shaA], { TEST_FAIL_BRANCH: "feat/first" });
    assert.equal(failure.code, 1);
    assert.equal((await f.state()).owner.status, "failed");
    await f.review("ready", "feat/second", shaB);
    assert.equal((await f.calls()).length, 1);
    assert.equal((await f.review("ready", "feat/first", shaA)).code, 0);
    assert.equal((await f.state()).owner.status, "healthy");
    assert.equal((await f.state()).queue[0].branch, "feat/second");
  } finally { await f.close(); }
});

test("a production merge advances only its owner, including when merged outside the agent chat", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "bin", "git"), `#!/usr/bin/env bash
if [[ "\${3:-}" == merge-base ]]; then [[ "$5" == "\${TEST_MERGED_SHA:-}" ]]; exit; fi
exec /usr/bin/git "$@"
`, { mode: 0o755 });
    await f.review("ready", "feat/first", shaA);
    await f.review("ready", "feat/second", shaB);
    await f.review("merged", shaB);
    assert.equal((await f.state()).owner.branch, "feat/first");
    const queuedMerge = await f.run(path.join(f.root, "deploy", "dev-review.sh"), ["merged", shaB], { TEST_MERGED_SHA: shaB });
    assert.equal(queuedMerge.code, 0, queuedMerge.output);
    assert.equal((await f.state()).owner.branch, "feat/first");
    assert.deepEqual((await f.state()).queue, []);
    await f.review("ready", "feat/second", shaB);
    const merge = await f.run(path.join(f.root, "deploy", "dev-review.sh"), ["merged", shaB], { TEST_MERGED_SHA: shaA });
    assert.equal(merge.code, 0, merge.output);
    assert.equal((await f.state()).owner.branch, "feat/second");
    assert.deepEqual(await f.calls(), [`feat/first ${shaA}`, `feat/second ${shaB}`]);
  } finally { await f.close(); }
});

test("invalid ready requests cannot claim dev; opting out never starts a deployment", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.review("ready", "bad branch", shaA)).code, 1);
    assert.equal((await f.review("ready", "feat/first", "bad-sha")).code, 1);
    assert.equal((await f.review("skip", "feat/first")).code, 0);
    assert.equal((await f.state()).owner, null);
    assert.deepEqual((await f.state()).queue, []);
    await assert.rejects(readFile(f.env.TEST_CALLS), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("rollout preserves an already selected review instead of letting the first new chat replace it", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "bin", "docker"), `#!/usr/bin/env bash
printf '%s\\n' '{"branch":"feat/already-reviewing","sha":"${shaA}","running":true}'
`, { mode: 0o755 });
    assert.equal((await f.review("ready", "feat/new", shaB)).code, 0);
    assert.equal((await f.state()).owner.branch, "feat/already-reviewing");
    assert.equal((await f.state()).owner.status, "existing");
    assert.equal((await f.state()).queue[0].branch, "feat/new");
    await assert.rejects(readFile(f.env.TEST_CALLS), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("heavy commands serialize across worktrees and preserve command failures", async () => {
  const f = await fixture();
  const script = new URL("../../tools/heavy.sh", import.meta.url).pathname;
  const work = "set -e; mkdir \"$TEST_SENTINEL\"; sleep 0.2; rmdir \"$TEST_SENTINEL\"";
  try {
    const results = await Promise.all([f.run(script, ["bash", "-c", work]), f.run(script, ["bash", "-c", work])]);
    for (const result of results) assert.equal(result.code, 0, result.output);
    assert.equal((await f.run(script, ["bash", "-c", "exit 17"])).code, 17);
    const blocked = await f.run(script, ["touch", f.env.TEST_CALLS], {
      UFC_HEAVY_MIN_AVAILABLE_KB: "999999999999", UFC_HEAVY_WAIT_SECONDS: "0",
    });
    assert.equal(blocked.code, 1);
    await assert.rejects(readFile(f.env.TEST_CALLS), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("the session launcher waits before starting more than its configured agent slots", async () => {
  const f = await fixture();
  const script = new URL("../../tools/agent-session.sh", import.meta.url).pathname;
  try {
    const work = "set -e; mkdir \"$TEST_SENTINEL\"; sleep 0.2; rmdir \"$TEST_SENTINEL\"";
    const results = await Promise.all([f.run(script, ["bash", "-c", work]), f.run(script, ["bash", "-c", work])]);
    for (const result of results) assert.equal(result.code, 0, result.output);
    assert.ok(results.some(result => result.output.includes("agent slots are occupied")));
  } finally { await f.close(); }
});

test("dev selection pins pushed code, verifies the running revision, and skips an identical healthy deploy", async () => {
  const f = await fixture();
  try {
    const repo = path.join(f.root, "repo");
    const remote = path.join(f.root, "origin.git");
    const dev = path.join(f.root, "dev-checkout");
    await mkdir(repo);
    await mkdir(path.join(repo, "deploy"));
    await mkdir(path.join(repo, "tools"));
    for (const name of ["select-dev-branch.sh", "build.sh"]) {
      await copyFile(new URL(`../../deploy/${name}`, import.meta.url), path.join(repo, "deploy", name));
    }
    await copyFile(new URL("../../dev.sh", import.meta.url), path.join(repo, "dev.sh"));
    await copyFile(new URL("../../tools/heavy.sh", import.meta.url), path.join(repo, "tools", "heavy.sh"));
    const { execFileSync } = await import("node:child_process");
    const g = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    g("init", "-b", "main");
    g("config", "user.email", "fixture@example.test");
    g("config", "user.name", "Fixture");
    g("add", ".");
    g("commit", "-m", "fixture");
    execFileSync("git", ["init", "--bare", remote], { stdio: "ignore" });
    g("remote", "add", "origin", remote);
    g("switch", "-c", "feat/ready");
    const pinned = g("rev-parse", "HEAD");
    await writeFile(path.join(repo, "newer.txt"), "newer work\n");
    g("add", "newer.txt");
    g("commit", "-m", "newer revision");
    g("push", "origin", "main", "feat/ready");
    g("switch", "main");
    g("worktree", "add", "--detach", dev, "main");
    await writeFile(path.join(repo, ".env.dev"), "DEV_CLERK_PUBLISHABLE_KEY=pk_test_fixture\nDEV_CLERK_SECRET_KEY=sk_test_fixture\nDEV_DEFAULT_ADMIN=fixture@example.test\nDEV_ADMIN_TOKEN=fixture\nDEV_TUNNEL_TOKEN=fixture\n");
    await writeFile(path.join(f.root, "bin", "docker"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_DOCKER_CALLS"
case "$1" in
  inspect) cat "$TEST_RUNNING" ;;
  image) awk '{print $2}' "$TEST_RUNNING" ;;
  buildx) exit 0 ;;
  compose)
    if [[ " $* " == *" up "* ]]; then
      printf '%s %s %s\\n' "$DEV_BRANCH" "$DEV_SHA" "\${TEST_HEALTH:-healthy}" > "$TEST_RUNNING"
    fi
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
    const extra = {
      UFC_PRODUCTION_DIR: repo, UFC_DEV_DIR: dev,
      TEST_RUNNING: path.join(f.root, "running"), TEST_DOCKER_CALLS: path.join(f.root, "docker-calls"),
    };
    const select = (sha: string, health = "healthy") => f.run(path.join(repo, "deploy", "select-dev-branch.sh"), ["feat/ready", sha], { ...extra, TEST_HEALTH: health });
    assert.equal((await select(shaB)).code, 2, "an unpushed SHA must be rejected");
    const first = await select(pinned);
    assert.equal(first.code, 0, first.output);
    assert.equal(execFileSync("git", ["-C", dev, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(), pinned);
    const before = await readFile(extra.TEST_DOCKER_CALLS, "utf8");
    assert.match(before, /build --builder ufcsh-bounded app-dev/);
    assert.match(before, /up -d --no-build --wait --wait-timeout 180 app-dev dev-tunnel/);
    const same = await select(pinned);
    assert.equal(same.code, 0, same.output);
    assert.match(same.output, /Already healthy/);
    const after = await readFile(extra.TEST_DOCKER_CALLS, "utf8");
    assert.equal(after.match(/build --builder/g)?.length, 1);
    await writeFile(extra.TEST_RUNNING, "stale revision unhealthy\n");
    const unhealthy = await select(pinned, "unhealthy");
    assert.equal(unhealthy.code, 1);
    assert.match(unhealthy.output, /not healthy on the requested commit/);
  } finally { await f.close(); }
});
