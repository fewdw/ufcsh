import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

test("concurrent SSH deployments serialize updates of the shared Git repository", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "ufcsh-deploy-lock-"));
  try {
    const repo = path.join(fixture, "repo");
    const bin = path.join(fixture, "bin");
    await mkdir(path.join(repo, "deploy"), { recursive: true });
    await mkdir(bin);
    await writeFile(path.join(bin, "git"), `#!/usr/bin/env bash
set -euo pipefail
shift 2
case "$1" in
  branch) echo main ;;
  status) exit 0 ;;
  fetch|merge)
    mkdir "$TEST_REF_SENTINEL" || { echo 'concurrent reference update' >&2; exit 17; }
    sleep 0.1
    rmdir "$TEST_REF_SENTINEL"
    ;;
  *) exit 2 ;;
esac
`, { mode: 0o755 });
    await writeFile(path.join(repo, "deploy", "remote-deploy.sh"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
    const source = await readFile(new URL("../../deploy/ssh-entrypoint.sh", import.meta.url), "utf8");
    const script = path.join(fixture, "entrypoint.sh");
    await writeFile(script, source.replace(/^repo_dir=.*$/m, `repo_dir=${JSON.stringify(repo)}`)
      .replaceAll("/tmp/ufcsh-git-fetch.lock", path.join(fixture, "fetch.lock")));
    const run = () => new Promise<{ code: number | null; error: string }>((resolve, reject) => {
      const child = spawn("bash", [script], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_REF_SENTINEL: path.join(fixture, "ref-writing") },
      });
      let error = "";
      child.stderr.on("data", data => { error += data; });
      child.on("error", reject);
      child.on("close", code => resolve({ code, error }));
    });
    const results = await Promise.all([run(), run()]);
    for (const result of results) assert.equal(result.code, 0, result.error);
  } finally { await rm(fixture, { recursive: true, force: true }); }
});

async function remoteDeploy(fixture: string, { available, update }: { available: string; update: number }) {
  const repo = path.join(fixture, "repo"), bin = path.join(fixture, "bin");
  const log = path.join(fixture, "calls");
  await mkdir(path.join(repo, "deploy"), { recursive: true });
  await mkdir(bin);
  const record = (name: string, code = 0) => `#!/usr/bin/env bash\necho "${name} $*" >> ${JSON.stringify(log)}\nexit ${code}\n`;
  await writeFile(path.join(bin, "git"), `#!/usr/bin/env bash\n[[ "$3" == rev-parse ]] && echo ${"a".repeat(40)}\nexit 0\n`, { mode: 0o755 });
  await writeFile(path.join(bin, "docker"), `#!/usr/bin/env bash
echo "docker $*" >> ${JSON.stringify(log)}
[[ "$1" == ps ]] && echo running-container
exit 0
`, { mode: 0o755 });
  await writeFile(path.join(repo, "deploy", "update.sh"), record("update", update), { mode: 0o755 });
  await writeFile(path.join(repo, "deploy", "dev-review.sh"), record("dev-review"), { mode: 0o755 });
  const source = await readFile(new URL("../../deploy/remote-deploy.sh", import.meta.url), "utf8");
  const script = path.join(repo, "deploy", "remote-deploy.sh");
  await writeFile(script, source.replaceAll("/tmp/ufcsh-", path.join(fixture, "lock-")), { mode: 0o755 });
  const code = await new Promise<number | null>((resolve, reject) => {
    const child = spawn("bash", [script], {
      stdio: "ignore",
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, SSH_ORIGINAL_COMMAND: `prod ${"a".repeat(40)}`,
        UFC_HEAVY_MIN_AVAILABLE_KB: available,
      },
    });
    child.on("error", reject);
    child.on("close", resolve);
  });
  const calls = (await readFile(log, "utf8")).trim().split("\n").map(line => line.split(" ").slice(0, 2).join(" "));
  return { code, calls };
}

test("a release short of memory takes dev's, and gives it back even when it fails", async () => {
  const enough = await mkdtemp(path.join(tmpdir(), "ufcsh-deploy-dev-"));
  const short = await mkdtemp(path.join(tmpdir(), "ufcsh-deploy-dev-"));
  const failed = await mkdtemp(path.join(tmpdir(), "ufcsh-deploy-dev-"));
  try {
    assert.deepEqual(await remoteDeploy(enough, { available: "0", update: 0 }), {
      code: 0, calls: ["update ", "dev-review merged"],
    });
    assert.deepEqual(await remoteDeploy(short, { available: "99999999999", update: 0 }), {
      code: 0, calls: ["docker ps", "docker stop", "update ", "docker start", "dev-review merged"],
    });
    assert.deepEqual(await remoteDeploy(failed, { available: "99999999999", update: 7 }), {
      code: 7, calls: ["docker ps", "docker stop", "update ", "docker start"],
    });
  } finally {
    for (const dir of [enough, short, failed]) await rm(dir, { recursive: true, force: true });
  }
});
