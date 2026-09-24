import sharp from "sharp";

/**
 * Link-preview images, 1200×630, drawn on the server so a shared fighter,
 * bout or card shows what it is about rather than the site's logo. Text is
 * SVG rasterised by sharp (the container ships DejaVu Sans); pictures come
 * from the local photo cache and are composited on top.
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export type SharePhoto = { data: Buffer; full: boolean } | null;
export type ShareCard =
  | { kind: "versus"; eyebrow: string; f1: string; f2: string; f1Line: string; f2Line: string; center: string; footer: string; photos: [SharePhoto, SharePhoto] }
  | { kind: "single"; eyebrow: string; title: string; lines: string[]; footer: string; photo: SharePhoto }
  | { kind: "list"; eyebrow: string; title: string; subtitle: string; items: string[]; footer: string };

const FONT = "DejaVu Sans, Inter, Arial, sans-serif";
const escape = (value: string) => value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[char]!));

/** Rough width check for DejaVu Sans Bold, enough to keep a name on its line. */
function sized(text: string, max: number, width: number, min = 26): number {
  const perChar = 0.62;
  return Math.max(min, Math.min(max, Math.floor(width / Math.max(1, text.length * perChar))));
}

function frame(inner: string, footer: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#17171b"/><stop offset="1" stop-color="#09090b"/></linearGradient>
    <radialGradient id="blue" cx="0.12" cy="0.4" r="0.6"><stop offset="0" stop-color="#3b82f6" stop-opacity="0.28"/><stop offset="1" stop-color="#3b82f6" stop-opacity="0"/></radialGradient>
    <radialGradient id="red" cx="0.88" cy="0.4" r="0.6"><stop offset="0" stop-color="#ef4444" stop-opacity="0.24"/><stop offset="1" stop-color="#ef4444" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#blue)"/>
  <rect width="100%" height="100%" fill="url(#red)"/>
  ${inner}
  <line x1="48" y1="560" x2="1152" y2="560" stroke="#ffffff" stroke-opacity="0.1"/>
  <text x="48" y="604" font-family="${FONT}" font-size="34" font-weight="800" fill="#fafafa">UFC<tspan fill="#a1a1aa">.sh</tspan></text>
  <text x="1152" y="600" text-anchor="end" font-family="${FONT}" font-size="20" fill="#a1a1aa">${escape(footer)}</text>
</svg>`;
}

async function photoLayer(photo: SharePhoto, width: number, height: number): Promise<Buffer | null> {
  if (!photo) return null;
  try {
    const fitted = await sharp(photo.data)
      .resize({ width, height, fit: photo.full ? "inside" : "cover", position: "top" })
      .ensureAlpha()
      .png()
      .toBuffer({ resolveWithObject: true });
    // Fade the last quarter so a cut-out ends in air rather than on a hard crop.
    const { width: w, height: h } = fitted.info;
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.7" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`);
    return await sharp(fitted.data).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  } catch {
    return null;
  }
}

export async function renderShareImage(card: ShareCard): Promise<Buffer> {
  const overlays: sharp.OverlayOptions[] = [];
  let inner = "";
  if (card.kind === "versus") {
    const photoW = 330;
    const photoH = 500;
    const layers = await Promise.all(card.photos.map((photo) => photoLayer(photo, photoW, photoH)));
    for (const [index, layer] of layers.entries()) {
      if (!layer || !layers.every(Boolean)) continue;
      const meta = await sharp(layer).metadata();
      const left = index === 0 ? 40 : OG_WIDTH - 40 - (meta.width ?? photoW);
      overlays.push({ input: layer, left: Math.round(left), top: Math.round(548 - (meta.height ?? photoH)) });
    }
    const hasPhotos = overlays.length === 2;
    const center = hasPhotos ? 600 : 600;
    const nameWidth = hasPhotos ? 440 : 1000;
    inner = `
      <text x="${center}" y="92" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3" fill="#fbbf24">${escape(card.eyebrow.toUpperCase())}</text>
      <text x="${center}" y="210" text-anchor="middle" font-family="${FONT}" font-size="${sized(card.f1, 58, nameWidth)}" font-weight="800" fill="#60a5fa">${escape(card.f1)}</text>
      <text x="${center}" y="258" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#a1a1aa">${escape(card.f1Line)}</text>
      <text x="${center}" y="318" text-anchor="middle" font-family="${FONT}" font-size="34" font-weight="900" fill="#71717a">VS</text>
      <text x="${center}" y="400" text-anchor="middle" font-family="${FONT}" font-size="${sized(card.f2, 58, nameWidth)}" font-weight="800" fill="#f87171">${escape(card.f2)}</text>
      <text x="${center}" y="448" text-anchor="middle" font-family="${FONT}" font-size="22" fill="#a1a1aa">${escape(card.f2Line)}</text>
      <text x="${center}" y="512" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="600" fill="#e4e4e7">${escape(card.center)}</text>`;
  } else if (card.kind === "single") {
    const layer = await photoLayer(card.photo, 420, 520);
    if (layer) {
      const meta = await sharp(layer).metadata();
      overlays.push({ input: layer, left: 48, top: Math.round(552 - (meta.height ?? 520)) });
    }
    const x = layer ? 500 : 80;
    inner = `
      <text x="${x}" y="130" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3" fill="#fbbf24">${escape(card.eyebrow.toUpperCase())}</text>
      <text x="${x}" y="222" font-family="${FONT}" font-size="${sized(card.title, 72, 1150 - x)}" font-weight="800" fill="#fafafa">${escape(card.title)}</text>
      ${card.lines.slice(0, 4).map((line, index) => `<text x="${x}" y="${300 + index * 52}" font-family="${FONT}" font-size="30" font-weight="${index === 0 ? 700 : 500}" fill="${index === 0 ? "#e4e4e7" : "#a1a1aa"}">${escape(line)}</text>`).join("")}`;
  } else {
    inner = `
      <text x="600" y="96" text-anchor="middle" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3" fill="#fbbf24">${escape(card.eyebrow.toUpperCase())}</text>
      <text x="600" y="172" text-anchor="middle" font-family="${FONT}" font-size="${sized(card.title, 60, 1080)}" font-weight="800" fill="#fafafa">${escape(card.title)}</text>
      <text x="600" y="220" text-anchor="middle" font-family="${FONT}" font-size="24" fill="#a1a1aa">${escape(card.subtitle)}</text>
      ${card.items.slice(0, 5).map((item, index) => `<text x="600" y="${296 + index * 52}" text-anchor="middle" font-family="${FONT}" font-size="${sized(item, 32, 1000, 20)}" font-weight="${index === 0 ? 800 : 600}" fill="${index === 0 ? "#fafafa" : "#d4d4d8"}">${escape(item)}</text>`).join("")}`;
  }
  const base = sharp(Buffer.from(frame(inner, card.footer)));
  return base.composite(overlays).flatten({ background: "#0b0b0e" }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
}
