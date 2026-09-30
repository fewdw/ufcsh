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
