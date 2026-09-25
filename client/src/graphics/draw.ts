import { flagEmoji } from "../flags";
import { DISPLAY } from "./fonts";

/**
 * The pieces every graphic is drawn from: type, the backdrop and its texture,
 * rank boxes, flags, share bars, badges and the footer mark. Sizes are in
 * `u`, a thousandth of the image's short side, so each shape scales alike.
 */

export type Theme = "red" | "gold" | "dark" | "light";
export type Ctx = CanvasRenderingContext2D;

export type Palette = {
  bg: string; bg2: string; ink: string; muted: string; faint: string; line: string; panel: string; panelStrong: string;
  /** The theme's own colour: section labels, the pick, the octagon. */
  accent: string; onAccent: string;
  f1: string; f2: string; win: string; loss: string; draw: string; gold: string;
  /** Rank boxes: a white square with dark figures on the dark themes. */
  box: string; onBox: string;
  glowA: string; glowB: string; shadow: string;
  texture: "scratches" | "rays" | "none"; grain: number; dark: boolean;
};

export const PALETTES: Record<Theme, Palette> = {
  red: {
    bg: "#0b0506", bg2: "#1d0709", ink: "#ffffff", muted: "#d4c4c4", faint: "#9b8686", line: "rgba(255,255,255,0.12)",
    panel: "rgba(255,255,255,0.06)", panelStrong: "rgba(255,255,255,0.11)", accent: "#ef3b36", onAccent: "#ffffff",
    f1: "#6aa8ff", f2: "#ff5a52", win: "#22c55e", loss: "#f43f5e", draw: "#f59e0b", gold: "#f5c542",
    box: "#ffffff", onBox: "#0b0506", glowA: "rgba(220,38,38,0.42)", glowB: "rgba(127,29,29,0.55)", shadow: "rgba(0,0,0,0.75)",
    texture: "scratches", grain: 0.07, dark: true,
  },
  gold: {
    bg: "#0a0907", bg2: "#1a160d", ink: "#ffffff", muted: "#d6ccb4", faint: "#9a8f76", line: "rgba(232,196,104,0.18)",
    panel: "rgba(232,196,104,0.07)", panelStrong: "rgba(232,196,104,0.13)", accent: "#e8c468", onAccent: "#15110a",
    f1: "#7fb2ff", f2: "#ff6b61", win: "#22c55e", loss: "#f43f5e", draw: "#f59e0b", gold: "#e8c468",
    box: "#ffffff", onBox: "#15110a", glowA: "rgba(232,196,104,0.26)", glowB: "rgba(120,90,30,0.30)", shadow: "rgba(0,0,0,0.75)",
    texture: "rays", grain: 0.06, dark: true,
  },
  dark: {
    bg: "#09090b", bg2: "#16161a", ink: "#fafafa", muted: "#b4b4bd", faint: "#7c7c86", line: "rgba(255,255,255,0.10)",
    panel: "rgba(255,255,255,0.05)", panelStrong: "rgba(255,255,255,0.10)", accent: "#fbbf24", onAccent: "#111111",
    f1: "#60a5fa", f2: "#f87171", win: "#10b981", loss: "#f43f5e", draw: "#f59e0b", gold: "#fbbf24",
    box: "#fafafa", onBox: "#09090b", glowA: "rgba(59,130,246,0.24)", glowB: "rgba(239,68,68,0.22)", shadow: "rgba(0,0,0,0.7)",
    texture: "none", grain: 0.05, dark: true,
  },
  light: {
    bg: "#ffffff", bg2: "#f1f1f3", ink: "#0a0a0c", muted: "#4b4b55", faint: "#7a7a84", line: "rgba(0,0,0,0.10)",
    panel: "rgba(0,0,0,0.04)", panelStrong: "rgba(0,0,0,0.08)", accent: "#d71f26", onAccent: "#ffffff",
    f1: "#1d4ed8", f2: "#c81e1e", win: "#059669", loss: "#e11d48", draw: "#d97706", gold: "#b7791f",
    box: "#0a0a0c", onBox: "#ffffff", glowA: "rgba(215,31,38,0.10)", glowB: "rgba(29,78,216,0.08)", shadow: "rgba(255,255,255,0.9)",
    texture: "none", grain: 0.035, dark: false,
  },
};

const SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const CONDENSED = `"${DISPLAY}", "Arial Narrow", "Roboto Condensed", ${SANS}`;
/** Running text: notes, sources, a bout's venue. */
export const sans = (weight: number, size: number) => `${weight} ${Math.max(1, Math.round(size))}px ${SANS}`;
/** Display type: names, numbers, labels. */
export const cond = (weight: number, size: number, italic = false) => `${italic ? "italic " : ""}${weight} ${Math.max(1, Math.round(size))}px ${CONDENSED}`;
export type Face = (size: number) => string;

type Spaced = Ctx & { letterSpacing?: string };
/** Canvas letter spacing where the browser has it; plain text where not. */
export function spacing(ctx: Ctx, px: number) {
  const spaced = ctx as Spaced;
  if ("letterSpacing" in spaced) spaced.letterSpacing = `${px}px`;
}

/** The largest size from `size` down to `min` at which `text` fits `width`. */
export function sizeFor(ctx: Ctx, text: string, width: number, face: Face, size: number, min = size * 0.6): number {
  let current = size;
  ctx.font = face(current);
  while (ctx.measureText(text).width > width && current > min) {
    current = Math.max(min, current - Math.max(1, current * 0.04));
    ctx.font = face(current);
  }
  return current;
}

/** Write `text` no wider than `width`, shrinking to `min`, then truncating. */
export function fit(ctx: Ctx, text: string, x: number, y: number, width: number, face: Face, size: number, min = size * 0.6): number {
  const used = sizeFor(ctx, text, width, face, size, min);
  let shown = text;
  if (ctx.measureText(shown).width > width) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > width) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  ctx.fillText(shown, x, y);
  return used;
}

/** Tracked capitals — the small labels over a section or a bout. */
export function label(ctx: Ctx, text: string, x: number, y: number, face: string, track: number, maxWidth?: number) {
  ctx.font = face;
  spacing(ctx, track);
  if (maxWidth && ctx.measureText(text).width > maxWidth) spacing(ctx, 0);
  if (maxWidth) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
  spacing(ctx, 0);
}

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A seeded generator, so the texture is the same every time an image is drawn. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const grainTiles = new Map<string, HTMLCanvasElement>();
function grainTile(dark: boolean): HTMLCanvasElement {
  const key = dark ? "dark" : "light";
  const cached = grainTiles.get(key);
  if (cached) return cached;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 160;
  const tctx = tile.getContext("2d")!;
  const data = tctx.createImageData(160, 160);
  const next = random(7);
  for (let index = 0; index < data.data.length; index += 4) {
    const value = next() > 0.5 ? 255 : 0;
    data.data[index] = data.data[index + 1] = data.data[index + 2] = dark ? value : 0;
    data.data[index + 3] = Math.round(next() * 255);
  }
  tctx.putImageData(data, 0, 0);
  grainTiles.set(key, tile);
  return tile;
}

export function octagon(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let index = 0; index < 8; index++) {
    const angle = Math.PI / 8 + (index * Math.PI) / 4;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** The backdrop: a wash, the theme's glow, its texture, grain and a vignette.
 *  `corners` lights the two sides in their corner colours on the dark theme. */
export function backdrop(ctx: Ctx, w: number, h: number, p: Palette, corners: boolean) {
  const u = Math.min(w, h) / 1000;
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, p.bg2);
  wash.addColorStop(0.55, p.bg);
  wash.addColorStop(1, p.bg2);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  const glow = (x: number, y: number, radius: number, color: string) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  };
  const big = Math.max(w, h);
  if (p.texture === "scratches") {
    glow(w * 0.5, h * 1.05, big * 0.75, p.glowA);
    glow(0, 0, big * 0.45, p.glowB);
    glow(w, 0, big * 0.45, p.glowB);
  } else if (p.texture === "rays") {
    glow(w * 0.5, -h * 0.05, big * 0.8, p.glowA);
    glow(w * 0.5, h * 1.1, big * 0.5, p.glowB);
  } else if (corners) {
    glow(w * 0.12, h * 0.35, big * 0.55, p.glowA);
    glow(w * 0.88, h * 0.35, big * 0.55, p.glowB);
  } else {
    glow(w * 0.3, h * 0.2, big * 0.6, p.glowA);
    glow(w * 0.8, h * 0.9, big * 0.5, p.glowB);
  }
  const next = random(Math.round(w * 7 + h));
  if (p.texture === "scratches") {
    // Scuffs across the canvas, like the red fight-night posters.
    ctx.save();
    ctx.lineCap = "round";
    for (let index = 0; index < 90; index++) {
      const x = next() * w;
      const y = next() * h;
      const length = (40 + next() * 260) * u;
      const angle = -0.25 + next() * 0.2;
      ctx.strokeStyle = next() > 0.35 ? `rgba(239,59,54,${0.05 + next() * 0.16})` : `rgba(255,220,200,${0.03 + next() * 0.06})`;
      ctx.lineWidth = (0.6 + next() * 2.2) * u;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (length / 2) * Math.cos(angle), y + (length / 2) * Math.sin(angle) + (next() - 0.5) * 6 * u, x + length * Math.cos(angle), y + length * Math.sin(angle));
      ctx.stroke();
    }
    ctx.restore();
  } else if (p.texture === "rays") {
    // Soft diagonal beams from the top, like a pay-per-view card.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let index = 0; index < 7; index++) {
      const x = w * (0.1 + index * 0.14 + (next() - 0.5) * 0.05);
      const beam = ctx.createLinearGradient(x, 0, x + w * 0.2, h);
      beam.addColorStop(0, "rgba(232,196,104,0.07)");
      beam.addColorStop(1, "rgba(232,196,104,0)");
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w * 0.05, 0);
      ctx.lineTo(x + w * 0.32, h);
      ctx.lineTo(x + w * 0.2, h);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  if (p.grain > 0) {
    ctx.save();
    ctx.globalAlpha = p.grain;
    ctx.fillStyle = ctx.createPattern(grainTile(p.dark), "repeat")!;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
  if (p.dark) {
    const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, big * 0.75);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
}

/** A rank as the posters print it: a square with the number, gold for a belt.
 *  Returns the width it took. `x` is the box's left edge. */
export function rankBox(ctx: Ctx, rank: string, x: number, midY: number, size: number, p: Palette): number {
  const belt = rank === "C" || rank === "IC";
  ctx.font = cond(800, size * (rank.length > 1 ? 0.72 : 0.84));
  const width = Math.max(size, ctx.measureText(rank).width + size * 0.34);
  ctx.fillStyle = belt ? p.gold : p.box;
  ctx.fillRect(x, midY - size / 2, width, size);
  ctx.fillStyle = belt ? "#111111" : p.onBox;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(rank, x + width / 2, midY + size * 0.04);
  ctx.textBaseline = "alphabetic";
  return width;
}
export function rankWidth(ctx: Ctx, rank: string, size: number): number {
  ctx.font = cond(800, size * (rank.length > 1 ? 0.72 : 0.84));
  return Math.max(size, ctx.measureText(rank).width + size * 0.34);
}

let flagsWork: boolean | null = null;
/** Flags are emoji: drawn in colour on phones and Macs, but as two bare
 *  letters where the system has no colour-emoji font. Those systems get none. */
export function flagsDrawable(): boolean {
  if (flagsWork != null) return flagsWork;
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 24;
    const pctx = probe.getContext("2d", { willReadFrequently: true })!;
    pctx.font = "20px sans-serif";
    pctx.textBaseline = "top";
    pctx.fillStyle = "#000";
    pctx.fillText(flagEmoji("US")!, 0, 0);
    const data = pctx.getImageData(0, 0, 24, 24).data;
    flagsWork = false;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 60 && (Math.abs(data[index] - data[index + 1]) > 40 || Math.abs(data[index + 1] - data[index + 2]) > 40)) { flagsWork = true; break; }
    }
  } catch { flagsWork = false; }
  return flagsWork;
}

/** A nationality flag centred on `midY`; returns the width it took, 0 if none. */
export function flag(ctx: Ctx, code: string | null | undefined, x: number, midY: number, size: number, align: "left" | "right" | "center"): number {
  const emoji = flagsDrawable() ? flagEmoji(code) : null;
  if (!emoji) return 0;
  ctx.font = `${Math.round(size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(emoji, x, midY);
  ctx.textBaseline = "alphabetic";
  return ctx.measureText(emoji).width;
}
export function flagWidth(ctx: Ctx, code: string | null | undefined, size: number): number {
  const emoji = flagsDrawable() ? flagEmoji(code) : null;
  if (!emoji) return 0;
  ctx.font = `${Math.round(size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  return ctx.measureText(emoji).width;
}

/** A filled circle with a tick, a cross or a dot in it. */
export function mark(ctx: Ctx, cx: number, cy: number, r: number, color: string, kind: "check" | "cross" | "dot", ink = "#ffffff") {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(1.5, r * 0.28);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "check") {
    ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.12, cy + r * 0.34);
    ctx.lineTo(cx + r * 0.48, cy - r * 0.32);
    ctx.stroke();
  } else if (kind === "cross") {
    ctx.moveTo(cx - r * 0.36, cy - r * 0.36);
    ctx.lineTo(cx + r * 0.36, cy + r * 0.36);
    ctx.moveTo(cx + r * 0.36, cy - r * 0.36);
    ctx.lineTo(cx - r * 0.36, cy + r * 0.36);
    ctx.stroke();
  } else {
    ctx.arc(cx, cy, r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export type Split = { label: string; f1: number; f2: number };

/** One share bar: the label over it, each side's share at its end. */
export function splitBar(ctx: Ctx, split: Split, x: number, y: number, width: number, height: number, p: Palette, u: number) {
  const figure = Math.min(height * 0.62, 46 * u);
  const barH = Math.max(6 * u, Math.min(14 * u, height * 0.16));
  const labelSize = Math.min(18 * u, height * 0.26);
  ctx.textAlign = "center";
  ctx.fillStyle = p.muted;
  label(ctx, split.label.toUpperCase(), x + width / 2, y + labelSize, cond(700, labelSize), 2.5 * u, width * 0.5);
  const baseline = y + height * 0.86;
  ctx.font = cond(800, figure);
  const pctW = ctx.measureText("100%").width + 14 * u;
  ctx.textAlign = "left";
  ctx.fillStyle = p.f1;
  ctx.fillText(`${split.f1}%`, x, baseline);
  ctx.textAlign = "right";
  ctx.fillStyle = p.f2;
  ctx.fillText(`${split.f2}%`, x + width, baseline);
  const barX = x + pctW;
  const barW = Math.max(10 * u, width - pctW * 2);
  const barY = baseline - figure * 0.36 - barH / 2;
  const gap = 3 * u;
  const leftW = split.f1 + split.f2 ? (barW - gap) * (split.f1 / (split.f1 + split.f2)) : (barW - gap) / 2;
  ctx.fillStyle = p.panelStrong;
  roundRect(ctx, barX, barY, barW, barH, barH / 2);
  ctx.fill();
  if (leftW > 0) {
    ctx.fillStyle = p.f1;
    roundRect(ctx, barX, barY, leftW, barH, barH / 2);
    ctx.fill();
  }
  if (barW - gap - leftW > 0) {
    ctx.fillStyle = p.f2;
    roundRect(ctx, barX + leftW + gap, barY, barW - gap - leftW, barH, barH / 2);
    ctx.fill();
  }
}

export type Footer = { url: string; notes: string[] };

/** The mark and the source line, identical on every template. Returns the
 *  top of the footer, the line everything else must stay above. */
export function footer(ctx: Ctx, w: number, h: number, u: number, pad: number, p: Palette, data: Footer): number {
  const base = h - pad;
  const top = base - 54 * u;
  ctx.strokeStyle = p.line;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath();
  ctx.moveTo(pad, top);
  ctx.lineTo(w - pad, top);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = p.ink;
  ctx.font = cond(800, 42 * u);
  ctx.fillText("UFC", pad, base - 6 * u);
  const ufc = ctx.measureText("UFC").width;
  ctx.fillStyle = p.accent;
  ctx.fillText(".sh", pad + ufc, base - 6 * u);
  const mark = ufc + ctx.measureText(".sh").width;
  ctx.fillStyle = p.faint;
  ctx.font = sans(500, 16 * u);
  ctx.fillText(data.url, pad + mark + 14 * u, base - 10 * u);
  const urlEnd = pad + mark + 14 * u + ctx.measureText(data.url).width;
  ctx.textAlign = "right";
  const notes = data.notes.slice(0, 2);
  notes.forEach((note, index) => {
    ctx.fillStyle = p.faint;
    fit(ctx, note, w - pad, base - 8 * u - (notes.length - 1 - index) * 20 * u, Math.max(80 * u, w - pad - urlEnd - 24 * u), (s) => sans(500, s), 15 * u, 10 * u);
  });
  ctx.textAlign = "left";
  return top;
}

/** A photo filling a box, cropped from the top so the face stays in frame. */
export function coverTop(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + Math.min(0, (h - dh) * 0.12), dw, dh);
}

/** A cut-out standing on the bottom of its box, faded out over its lower part. */
export function cutout(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number, align: "left" | "right" | "center", fadeFrom = 0.7) {
  const scale = Math.min(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  const dx = align === "left" ? x : align === "right" ? x + w - dw : x + (w - dw) / 2;
  const dy = y + h - dh;
  const layer = document.createElement("canvas");
  layer.width = Math.max(1, Math.round(dw));
  layer.height = Math.max(1, Math.round(dh));
  const lctx = layer.getContext("2d")!;
  lctx.drawImage(image, 0, 0, layer.width, layer.height);
  lctx.globalCompositeOperation = "destination-in";
  const fade = lctx.createLinearGradient(0, 0, 0, layer.height);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(fadeFrom, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  lctx.fillStyle = fade;
  lctx.fillRect(0, 0, layer.width, layer.height);
  ctx.drawImage(layer, dx, dy);
}

/** A headshot in a ringed circle. */
export function roundel(ctx: Ctx, image: HTMLImageElement, cx: number, cy: number, size: number, ring: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  coverTop(ctx, image, cx - size / 2, cy - size / 2, size, size);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(3, size * 0.03);
  ctx.strokeStyle = ring;
  ctx.stroke();
}

export type Outcome = "win" | "loss" | "draw" | "nc" | null;

/** Last-five squares, oldest first. `x` is the left edge, or centre/right per `align`. */
export function formSquares(ctx: Ctx, form: Outcome[], x: number, y: number, size: number, p: Palette, align: "left" | "right" | "center"): number {
  const gap = size * 0.28;
  const total = form.length * size + Math.max(0, form.length - 1) * gap;
  let start = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  for (const outcome of form) {
    ctx.fillStyle = outcome === "win" ? p.win : outcome === "loss" ? p.loss : outcome === "draw" ? p.draw : p.faint;
    roundRect(ctx, start, y, size, size, size * 0.2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = cond(800, size * 0.72);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(outcome === "win" ? "W" : outcome === "loss" ? "L" : outcome === "draw" ? "D" : "–", start + size / 2, y + size / 2 + size * 0.04);
    start += size + gap;
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  return total;
}

/** A rounded pill with centred text; returns its width. */
export function pill(ctx: Ctx, text: string, cx: number, y: number, height: number, fill: string, ink: string, face: string, maxWidth = Infinity): number {
  ctx.font = face;
  const width = Math.min(maxWidth, ctx.measureText(text).width + height * 0.9);
  roundRect(ctx, cx - width / 2, y, width, height, height / 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y + height / 2 + height * 0.04, width - height * 0.6);
  ctx.textBaseline = "alphabetic";
  return width;
}
