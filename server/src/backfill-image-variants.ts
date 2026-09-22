import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureImageVariant, variantPath } from "./image-variants.ts";

const projectData = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
const directory = path.join(process.env.DATA_DIR || projectData, "images");
const names = (await fs.readdir(directory)).filter(name =>
  /^[a-f0-9]{16}(?:\.full)?\.[a-f0-9]{12}\.img$/i.test(name));
let completed = 0;
let generated = 0;
let failed = 0;
const queue = [...names];

async function worker(): Promise<void> {
  for (let name; (name = queue.shift());) {
    const original = path.join(directory, name);
    try {
      for (const size of ["tiny", "small"] as const) {
        const target = variantPath(original, size);
        try {
          if ((await fs.stat(target)).size > 0) continue;
        } catch { /* Missing or empty variant. */ }
        await ensureImageVariant(original, size);
        generated++;
      }
      completed++;
    } catch (error) {
      failed++;
      console.error(`Failed ${name}:`, error);
    }
  }
}

await Promise.all(Array.from({ length: 4 }, () => worker()));
console.log(`Images checked: ${completed}/${names.length}; variants generated: ${generated}; failed: ${failed}`);
if (failed) process.exitCode = 1;
