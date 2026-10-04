import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Entry = { branch: string; sha: string };
type Owner = Entry & { status: "existing" | "deploying" | "healthy" | "failed" };
type State = { owner: Owner | null; queue: Entry[] };

const stateFile = path.join(process.env.UFC_REVIEW_STATE_DIR!, "state.json");
const deployScript = fileURLToPath(new URL("./select-dev-branch.sh", import.meta.url));
const [command, branch, sha] = process.argv.slice(2);
function initialState(): State {
  const empty: State = { owner: null, queue: [] };
  const inspect = spawnSync("docker", ["inspect", "--format",
    '{"branch":{{json (index .Config.Labels "sh.ufc.dev.branch")}},"sha":{{json (index .Config.Labels "org.opencontainers.image.revision")}},"running":{{.State.Running}}}',
    "ufcsh-app-dev-1"], { encoding: "utf8" });
  if (inspect.status !== 0) return empty;
  const running = JSON.parse(inspect.stdout);
  if (!running.running || running.branch === "main") return empty;
  if (running.branch && /^[0-9a-f]{40}$/.test(running.sha)) {
    return { owner: { branch: running.branch, sha: running.sha, status: "existing" }, queue: [] };
  }
  // Old containers have no revision labels. Preserve an existing feature review
  // during rollout, but don't present its checkout as verified running code.
  const repo = process.env.UFC_PRODUCTION_DIR || "/home/ubuntu/ufcsh";
  const dev = process.env.UFC_DEV_DIR || path.join(path.dirname(repo), "ufcsh-dev");
  const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).stdout?.trim();
  const current = git(dev, "rev-parse", "HEAD");
  if (!current || current === git(repo, "rev-parse", "refs/remotes/origin/main")) return empty;
  const branches = (git(repo, "for-each-ref", "--format=%(refname:strip=3)", `--points-at=${current}`, "refs/remotes/origin") || "")
    .split("\n").filter(name => name && name !== "main" && name !== "HEAD");
  return { owner: { branch: branches.length === 1 ? branches[0] : "existing-review", sha: current, status: "existing" }, queue: [] };
}
const state: State = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : initialState();

function save() {
  const temporary = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(state) + "\n", { mode: 0o600 });
  renameSync(temporary, stateFile);
}

function validBranch(value: string | undefined) {
  if (!value || spawnSync("git", ["check-ref-format", "--branch", value], { stdio: "ignore" }).status !== 0) {
    throw new Error("A valid branch name is required.");
  }
}

function entry(): Entry {
  validBranch(branch);
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error("A full pushed commit SHA is required.");
  return { branch, sha };
}

function enqueue(request: Entry) {
  const index = state.queue.findIndex(item => item.branch === request.branch);
  if (index < 0) state.queue.push(request);
  else state.queue[index] = request; // New work keeps its place in the queue.
}

function deploy(request: Entry, preserveOwner = false) {
  if (preserveOwner && state.owner && state.owner.branch !== request.branch && state.owner.branch !== "main") {
    const previous = { branch: state.owner.branch, sha: state.owner.sha };
    if (!state.queue.some(item => item.branch === previous.branch)) state.queue.unshift(previous);
  }
  state.queue = state.queue.filter(item => item.branch !== request.branch);
  state.owner = { ...request, status: "deploying" };
  save(); // A crash leaves a claimed slot, so another chat cannot silently replace it.
  const result = spawnSync(deployScript, [request.branch, request.sha], { stdio: "inherit" });
  state.owner.status = result.status === 0 ? "healthy" : "failed";
  if (result.status === 0 && request.branch === "main") state.owner = null;
  save();
  if (result.status !== 0) {
    throw new Error(`Dev deployment failed for ${request.branch}; its slot is retained. Retry it or explicitly select another branch.`);
  }
}

try {
  switch (command) {
    case "ready": {
      const request = entry();
      if (!state.owner || state.owner.branch === request.branch) deploy(request);
      else {
        enqueue(request);
        save();
        console.log(`Queued ${branch}. Dev is reserved for ${state.owner.branch}; no deployment started.`);
      }
      break;
    }
    case "priority": deploy(entry(), true); break;
    case "skip":
      validBranch(branch);
      state.queue = state.queue.filter(item => item.branch !== branch);
      save();
      console.log(`${branch} will not be deployed. Current dev selection is unchanged.`);
      break;
    case "next": {
      const next = state.queue[0];
      if (next) deploy(next);
      else console.log("No finished branches are waiting. Current dev selection is unchanged.");
      break;
    }
    case "release":
      validBranch(branch);
      state.queue = state.queue.filter(item => item.branch !== branch);
      if (state.owner?.branch === branch) {
        state.owner = null;
        save();
        const next = state.queue[0];
        if (next) deploy(next);
        else console.log(`Released ${branch}. The next finished task can claim dev.`);
      } else {
        save();
        console.log(`${branch} does not own dev; current selection is unchanged.`);
      }
      break;
    case "status":
      console.log(state.owner ? `Dev: ${state.owner.branch} ${state.owner.sha} (${state.owner.status})` : "Dev review slot: free");
      console.log(state.queue.length ? `Waiting: ${state.queue.map(item => `${item.branch} ${item.sha.slice(0, 7)}`).join(", ")}` : "Waiting: none");
      break;
    default: throw new Error("Usage: dev-review.sh ready|priority BRANCH SHA | skip|release BRANCH | next|status");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
