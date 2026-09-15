import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const serverDir = fileURLToPath(new URL("..", import.meta.url));
const source = path.join(process.env.DATA_DIR || path.join(serverDir, "data"), "ufc.db");
const temporary = await mkdtemp(path.join(tmpdir(), "ufcsh-tests-"));
try {
  const original = new DatabaseSync(source, { readOnly: true });
  try { await backup(original, path.join(temporary, "ufc.db")); }
  finally { original.close(); }
  process.env.DATA_DIR = temporary;
  process.env.DB_INIT = "1";
  const { db } = await import("./db.ts");
  db.close();
  const files = (await readdir(path.join(serverDir, "src"), { recursive: true }))
    .filter(file => file.endsWith(".test.ts")).map(file => path.join(serverDir, "src", file));
  const child = spawn(process.execPath, ["--test", "--test-concurrency=2", ...files], {
    cwd: serverDir, stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", DB_INIT: "0", NO_SYNC: "1", API_WORKERS: "0" },
  });
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolve(code ?? 1));
  });
} finally { await rm(temporary, { recursive: true, force: true }); }
