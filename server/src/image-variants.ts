import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

export type ImageSize = "tiny" | "small";

/** Pixel heights. Headshots are 520×325 and full bodies 460×700; `small`
 *  covers every avatar up to 80 CSS px on a 2× screen, `tiny` is a placeholder
 *  of a few hundred bytes that paints while the sharper copies load. */
export const VARIANT_HEIGHT = {
  head: { tiny: 20, small: 160 },
  full: { tiny: 40, small: 320 },
} as const;
const QUALITY = { tiny: 40, small: 72 } as const;

const pending = new Map<string, Promise<Buffer>>();

export function variantPath(originalPath: string, size: ImageSize): string {
  if (!originalPath.endsWith(".img")) throw new Error("Expected a cached image path");
  return `${originalPath.slice(0, -4)}.${size}.webp`;
}

/** Written atomically so a request never reads a partially encoded file. */
export async function ensureImageVariant(originalPath: string, size: ImageSize, source?: Buffer): Promise<Buffer> {
  const target = variantPath(originalPath, size);
  try { return await fs.readFile(target); } catch { /* Created below. */ }
  const running = pending.get(target);
  if (running) return running;

  const task = (async () => {
    const original = source ?? await fs.readFile(originalPath);
    const height = VARIANT_HEIGHT[originalPath.includes(".full.") ? "full" : "head"][size];
    const data = await sharp(original, { limitInputPixels: 20_000_000 })
      .resize({ height, withoutEnlargement: true })
      .webp({ quality: QUALITY[size], alphaQuality: QUALITY[size], effort: 4 })
      .toBuffer();
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, data, { flag: "wx" });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    return data;
  })().finally(() => pending.delete(target));
  pending.set(target, task);
  return task;
}
