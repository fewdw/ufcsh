import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The client's Docker build copies only the server files the client imports
// (Dockerfile, "Shared client/server evidence and calculation rules"). CI and
// local builds see the whole repository, so a missing one fails only there.
const root = fileURLToPath(new URL("../..", import.meta.url));
const imports = (file: string) => [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(match => match[1]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? sources(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("the client's Docker build copies every server file the client imports", () => {
  const server = path.join(root, "server/src");
  const needed = new Set<string>();
  const visit = (file: string) => {
    for (const specifier of imports(file)) {
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (!target.startsWith(server + path.sep) || needed.has(target)) continue;
      needed.add(target);
      visit(target);
    }
  };
  for (const file of sources(path.join(root, "client/src"))) visit(file);
  const copied = new Set([...readFileSync(path.join(root, "Dockerfile"), "utf8").matchAll(/^COPY (.+) \/app\/server\/src\/$/gm)]
    .flatMap(match => match[1].split(/\s+/)).map(file => path.join(root, file)));
  const missing = [...needed].filter(file => !copied.has(file)).map(file => path.relative(root, file));
  assert.ok(needed.size > 0);
  assert.deepEqual(missing, [], "add these to the client stage's COPY line in Dockerfile");
});
