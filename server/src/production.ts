import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.NODE_ENV = "production";
process.env.SYNC_MODE = "external";
process.env.DB_INIT = "1";
// Migrations finish before any other database connection is opened.
const { db } = await import("./db.ts");
db.close();
const env = { ...process.env, DB_INIT: "0" };
const entries = process.env.NO_SYNC === "1" ? ["index.ts"] : ["index.ts", "sync-worker.ts"];
const children = entries.map(entry => spawn(process.execPath, [fileURLToPath(new URL(entry, import.meta.url))], { env, stdio: "inherit" }));
let stopping = false;
let exitCode = 0;
let exited = 0;
const stop = (code: number) => {
  if (stopping) return;
  stopping = true;
  exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 12_000).unref();
};
for (const child of children) {
  child.on("error", error => { console.error("production process failed:", error); stop(1); });
  child.on("close", () => {
    exited++;
    if (!stopping) stop(1);
    if (exited === children.length) process.exit(exitCode);
  });
}
process.once("SIGTERM", () => stop(0));
process.once("SIGINT", () => stop(0));
