import { flagEmoji } from "../flags";
import { DISPLAY, TEXT } from "./fonts";

/**
 * The pieces every graphic is drawn from: type, the backdrop, rank boxes,
 * flags, share bars, form squares and the footer mark. Sizes are in `u`, a
 * thousandth of the image's short side, so each shape scales alike. Everything
 * is flat: no glows, shadows or fades, so edges stay crisp at any size.
 */

export type Theme = "red" | "gold" | "dark" | "light";
export type Ctx = CanvasRenderingContext2D;

export type Palette = {
  /** The canvas, and the flatter panel under a picture's edge. */
  bg: string; raised: string;
  ink: string; muted: string; faint: string; line: string;
  /** Chips and bars over either surface. */
  panel: string; panelStrong: string;
  /** The theme's own colour: section labels, the badge, the date. */
  accent: string; onAccent: string;
  f1: string; f2: string; win: string; loss: string; draw: string; gold: string;
  /** Rank boxes: a white square with dark figures on the dark themes. */
  box: string; onBox: string;
  dark: boolean;
};

export const PALETTES: Record<Theme, Palette> = {
  red: {
    bg: "#14070a", raised: "#1e0b0e", ink: "#ffffff", muted: "#d9c9ca", faint: "#9d8789", line: "rgba(255,255,255,0.12)",
    panel: "rgba(255,255,255,0.06)", panelStrong: "rgba(255,255,255,0.11)", accent: "#ef3b36", onAccent: "#ffffff",
    f1: "#6aa8ff", f2: "#ff5a52", win: "#22c55e", loss: "#f43f5e", draw: "#f59e0b", gold: "#f5c542",
    box: "#ffffff", onBox: "#14070a", dark: true,
  },
  gold: {
    bg: "#0d0b08", raised: "#17140e", ink: "#ffffff", muted: "#d9d0ba", faint: "#9a8f76", line: "rgba(232,196,104,0.2)",
    panel: "rgba(232,196,104,0.07)", panelStrong: "rgba(232,196,104,0.14)", accent: "#e8c468", onAccent: "#15110a",
    f1: "#7fb2ff", f2: "#ff6b61", win: "#22c55e", loss: "#f43f5e", draw: "#f59e0b", gold: "#e8c468",
    box: "#ffffff", onBox: "#15110a", dark: true,
  },
  dark: {
    bg: "#0b0b0e", raised: "#151519", ink: "#fafafa", muted: "#b9b9c2", faint: "#7c7c86", line: "rgba(255,255,255,0.11)",
    panel: "rgba(255,255,255,0.05)", panelStrong: "rgba(255,255,255,0.10)", accent: "#fbbf24", onAccent: "#111111",
    f1: "#60a5fa", f2: "#f87171", win: "#10b981", loss: "#f43f5e", draw: "#f59e0b", gold: "#fbbf24",
    box: "#fafafa", onBox: "#0b0b0e", dark: true,
  },
  light: {
    bg: "#ffffff", raised: "#f3f3f5", ink: "#0a0a0c", muted: "#4b4b55", faint: "#7a7a84", line: "rgba(0,0,0,0.11)",
    panel: "rgba(0,0,0,0.04)", panelStrong: "rgba(0,0,0,0.08)", accent: "#d71f26", onAccent: "#ffffff",
    f1: "#1d4ed8", f2: "#c81e1e", win: "#059669", loss: "#e11d48", draw: "#d97706", gold: "#b7791f",
    box: "#0a0a0c", onBox: "#ffffff", dark: false,
  },
};

const SANS = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const px = (size: number) => `${Math.max(1, Math.round(size * 10) / 10)}px`;
/** Names and figures: heavy condensed capitals. */
export const display = (size: number) => `${px(size)} "${DISPLAY}", Impact, "Arial Narrow", ${SANS}`;
/** Labels, records and notes. */
export const text = (weight: number, size: number) => `${weight} ${px(size)} "${TEXT}", ${SANS}`;
export type Face = (size: number) => string;

type Spaced = Ctx & { letterSpacing?: string };
/** Canvas letter spacing where the browser has it; plain text where not. */
export function spacing(ctx: Ctx, px: number) {
  const spaced = ctx as Spaced;
  if ("letterSpacing" in spaced) spaced.letterSpacing = `${px}px`;
}
/** Tracking adds space after the last letter too; this moves an anchor so
 *  the letters themselves, not that space, sit where they were aimed. */
function trackShift(ctx: Ctx): number {
  const track = parseFloat((ctx as Spaced).letterSpacing ?? "0") || 0;
  return ctx.textAlign === "center" ? track / 2 : ctx.textAlign === "right" || ctx.textAlign === "end" ? track : 0;
}

/** The largest size from `size` down to `min` at which `text` fits `width`. */
export function sizeFor(ctx: Ctx, text: string, width: number, face: Face, size: number, min = size * 0.6): number {
  let current = size;
  ctx.font = face(current);
  while (ctx.measureText(text).width > width && current > min) {
    current = Math.max(min, current - Math.max(0.5, current * 0.03));
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
  const at = x + trackShift(ctx);
  if (maxWidth) ctx.fillText(text, at, y, maxWidth);
  else ctx.fillText(text, at, y);
  spacing(ctx, 0);
}

/** How tall a face's capitals stand, for lining shapes up with them. */
export function capHeight(ctx: Ctx, face: string): number {
  ctx.font = face;
  return ctx.measureText("H").actualBoundingBoxAscent;
}

/** The baseline that centres `text`'s own ink on `midY`, rather than the
 *  font's em box, which sits capitals visibly high or low in a pill. */
export function middle(ctx: Ctx, text: string, midY: number): number {
  const box = ctx.measureText(text);
  return midY + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2;
}

/** Text whose ink is centred on (`cx`, `midY`), in the current font and colour. */
export function centered(ctx: Ctx, text: string, cx: number, midY: number, maxWidth?: number) {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const y = middle(ctx, text, midY);
  const x = cx + trackShift(ctx);
  if (maxWidth) ctx.fillText(text, x, y, maxWidth);
  else ctx.fillText(text, x, y);
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

/** The backdrop: one flat colour. */
export function backdrop(ctx: Ctx, w: number, h: number, p: Palette) {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
}

/** The figures inside a rank box fill this share of its height. */
const RANK_INK = 0.56;
function rankFace(ctx: Ctx, rank: string, size: number): string {
  const cap = capHeight(ctx, display(100)) / 100 || 0.7;
  return display((size * (rank.length > 1 ? RANK_INK * 0.86 : RANK_INK)) / cap);
}
/** A rank as the posters print it: a square with the number, gold for a belt.
 *  `size` is its height, best set to the cap height of the name beside it.
 *  Returns the width it took. `x` is the box's left edge. */
export function rankBox(ctx: Ctx, rank: string, x: number, midY: number, size: number, p: Palette): number {
  const belt = rank === "C" || rank === "IC";
  const width = rankWidth(ctx, rank, size);
  roundRect(ctx, x, midY - size / 2, width, size, size * 0.08);
  ctx.fillStyle = belt ? p.gold : p.box;
  ctx.fill();
  ctx.font = rankFace(ctx, rank, size);
  ctx.fillStyle = belt ? "#111111" : p.onBox;
  centered(ctx, rank, x + width / 2, midY);
  return width;
}
export function rankWidth(ctx: Ctx, rank: string, size: number): number {
  ctx.font = rankFace(ctx, rank, size);
  return Math.max(size, ctx.measureText(rank).width + size * 0.46);
}

let flagsWork: boolean | null = null;
/** Flags are emoji: drawn in colour on phones and Macs, but as two bare
 *  letters where the system has no colour-emoji font. Those systems get none. */
function flagsDrawable(): boolean {
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

const EMOJI = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
/** A nationality flag whose ink is centred on `midY`; returns the width it took, 0 if none. */
export function flag(ctx: Ctx, code: string | null | undefined, x: number, midY: number, size: number, align: "left" | "right" | "center"): number {
  const emoji = flagsDrawable() ? flagEmoji(code) : null;
  if (!emoji) return 0;
  ctx.font = `${px(size)} ${EMOJI}`;
  ctx.textAlign = align;
  ctx.fillStyle = "#000";
  ctx.fillText(emoji, x, middle(ctx, emoji, midY));
  return ctx.measureText(emoji).width;
}
export function flagWidth(ctx: Ctx, code: string | null | undefined, size: number): number {
  const emoji = flagsDrawable() ? flagEmoji(code) : null;
  if (!emoji) return 0;
  ctx.font = `${px(size)} ${EMOJI}`;
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

/** A rule with a label in its middle: "TALE OF THE TAPE". `y` is the rule's centre. */
export function heading(ctx: Ctx, title: string, x0: number, x1: number, y: number, u: number, p: Palette, size = 16 * u) {
  const cx = (x0 + x1) / 2;
  ctx.font = text(700, size);
  spacing(ctx, size * 0.2);
  const shown = title.toLocaleUpperCase("en-US");
  const width = Math.min(ctx.measureText(shown).width, (x1 - x0) * 0.8);
  ctx.fillStyle = p.accent;
  centered(ctx, shown, cx, y, (x1 - x0) * 0.8);
  spacing(ctx, 0);
  ctx.fillStyle = p.line;
  const gap = 16 * u;
  const thick = Math.max(1, 1.5 * u);
  ctx.fillRect(x0, y - thick / 2, Math.max(0, cx - width / 2 - gap - x0), thick);
  ctx.fillRect(cx + width / 2 + gap, y - thick / 2, Math.max(0, x1 - cx - width / 2 - gap), thick);
}

export type Split = { label: string; f1: number; f2: number };

/** One share bar: each side's share on its axis, the label between them and
 *  the bar under all three. `axes` default to a fifth in from each end. */
export function splitBar(ctx: Ctx, split: Split, x: number, y: number, width: number, height: number, p: Palette, u: number, axes?: [number, number]) {
  const [a1, a2] = axes ?? [x + width * 0.2, x + width * 0.8];
  const barH = Math.max(6 * u, Math.min(12 * u, height * 0.14));
  const figure = Math.min(height * 0.5, 44 * u);
  const face = display(figure);
  const figureMid = y + capHeight(ctx, face) / 2;
  ctx.font = face;
  ctx.fillStyle = p.f1;
  centered(ctx, `${split.f1}%`, a1, figureMid);
  ctx.fillStyle = p.f2;
  centered(ctx, `${split.f2}%`, a2, figureMid);
  const labelSize = Math.min(15 * u, height * 0.22);
  ctx.font = text(600, labelSize);
  spacing(ctx, labelSize * 0.14);
  ctx.fillStyle = p.muted;
  centered(ctx, split.label.toLocaleUpperCase("en-US"), (a1 + a2) / 2, figureMid, Math.max(40 * u, a2 - a1 - figure * 2.6));
  spacing(ctx, 0);
  const barY = y + height - barH;
  const gap = 3 * u;
  const total = split.f1 + split.f2;
  const leftW = total ? (width - gap) * (split.f1 / total) : (width - gap) / 2;
  ctx.fillStyle = p.panelStrong;
  roundRect(ctx, x, barY, width, barH, barH / 2);
  ctx.fill();
  if (leftW > 0) {
    ctx.fillStyle = p.f1;
    roundRect(ctx, x, barY, leftW, barH, barH / 2);
    ctx.fill();
  }
  if (width - gap - leftW > 0) {
    ctx.fillStyle = p.f2;
    roundRect(ctx, x + leftW + gap, barY, width - gap - leftW, barH, barH / 2);
    ctx.fill();
  }
}

/** The bar along the foot: the date and venue when there is one, the mark,
 *  and what the numbers are as of. */
export type Footer = { note: string | null; date?: { big: string; small: string } | null };

/** Where the bar starts; everything else stays above it. */
export const barTop = (h: number, u: number) => h - 108 * u;

/** A solid bar across the foot, as fight posters close: the date in the
 *  theme's colour and the venue on the left, the mark and the note on the right. */
export function bar(ctx: Ctx, w: number, h: number, u: number, pad: number, p: Palette, data: Footer) {
  const top = barTop(h, u);
  const mid = (top + h) / 2;
  ctx.fillStyle = p.dark ? "#000000" : "#0a0a0c";
  ctx.fillRect(0, top, w, h - top);
  const markFace = display(38 * u);
  const markCap = capHeight(ctx, markFace);
  const noteFace = (size: number) => text(500, size);
  // The mark, with the note under it when the date holds the left; beside it when not.
  const stacked = Boolean(data.date);
  ctx.font = markFace;
  const markW = ctx.measureText("UFC").width + ctx.measureText(".sh").width;
  let right = w - pad;
  let noteRoom = 0;
  if (data.note && stacked) {
    const size = sizeFor(ctx, data.note, w * 0.42, noteFace, 14 * u, 11 * u);
    ctx.font = noteFace(size);
    const noteCap = capHeight(ctx, noteFace(size));
    const block = markCap + 12 * u + noteCap;
    const markBase = mid - block / 2 + markCap;
    drawMark(ctx, w - pad, markBase, markFace, p, "right");
    ctx.font = noteFace(size);
    ctx.textAlign = "right";
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(data.note, w - pad, markBase + 12 * u + noteCap, w * 0.42);
    ctx.font = noteFace(size);
    right = w - pad - Math.max(markW, Math.min(w * 0.42, ctx.measureText(data.note).width)) - 36 * u;
  } else {
    drawMark(ctx, stacked ? w - pad : pad, mid + markCap / 2, markFace, p, stacked ? "right" : "left");
    if (stacked) right = w - pad - markW - 36 * u;
    else noteRoom = w - pad * 2 - markW - 36 * u;
  }
  if (data.note && !stacked) {
    ctx.fillStyle = "#a1a1aa";
    ctx.textAlign = "right";
    const size = sizeFor(ctx, data.note, noteRoom, noteFace, 16 * u, 11 * u);
    ctx.font = noteFace(size);
    ctx.fillText(data.note, w - pad, middle(ctx, data.note, mid), noteRoom);
  }
  if (data.date) {
    // "OCT 31 SAT", then the venue over two short lines beside it.
    const dateSize = sizeFor(ctx, data.date.big.toLocaleUpperCase("en-US"), (right - pad) * 0.62, display, 54 * u, 30 * u);
    ctx.font = display(dateSize);
    ctx.fillStyle = p.accent;
    ctx.textAlign = "left";
    const big = data.date.big.toLocaleUpperCase("en-US");
    ctx.fillText(big, pad, mid + capHeight(ctx, display(dateSize)) / 2);
    const lines = data.date.small ? data.date.small.split(" · ").slice(0, 2).map((line) => line.toLocaleUpperCase("en-US")) : [];
    const x = pad + ctx.measureText(big).width + 30 * u;
    const room = right - x;
    if (lines.length && room > 80 * u) {
      const size = Math.min(...lines.map((line) => sizeFor(ctx, line, room, (s) => text(700, s), 17 * u, 11 * u)));
      const face = text(700, size);
      const cap = capHeight(ctx, face);
      const gap = cap * 0.9;
      const block = cap * lines.length + gap * (lines.length - 1);
      ctx.fillStyle = "#ffffff";
      lines.forEach((line, index) => {
        label(ctx, line, x, mid - block / 2 + cap + index * (cap + gap), face, 1.2 * u, room);
      });
    }
  }
  ctx.textAlign = "left";
  return top;
}

function drawMark(ctx: Ctx, x: number, base: number, face: string, p: Palette, align: "left" | "right") {
  ctx.font = face;
  ctx.textAlign = "left";
  const ufc = ctx.measureText("UFC").width;
  const left = align === "left" ? x : x - ufc - ctx.measureText(".sh").width;
  ctx.fillStyle = "#ffffff";
  ctx.fillText("UFC", left, base);
  ctx.fillStyle = p.accent;
  ctx.fillText(".sh", left + ufc, base);
}

/** Flat diagonal bands in the theme's colour, as on the posters, filling a box. */
export function stripes(ctx: Ctx, x: number, y: number, w: number, h: number, p: Palette) {
  // Each band: where it crosses the box's top edge (a share of its width), its width and strength.
  const bands: [number, number, number][] = [[0.34, 0.07, 0.07], [0.5, 0.018, 0.16], [0.66, 0.12, 0.06], [0.86, 0.03, 0.13], [1.02, 0.1, 0.07], [1.22, 0.02, 0.15]];
  const slope = 0.85; // across per unit down
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = p.accent;
  for (const [at, width, alpha] of bands) {
    const x0 = x + at * w;
    const bw = width * w;
    ctx.globalAlpha = p.dark ? alpha : alpha * 0.55;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + bw, y);
    ctx.lineTo(x0 + bw - h * slope, y + h);
    ctx.lineTo(x0 - h * slope, y + h);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** The event's square badge: "UFC" over its number or series. */
export function badge(ctx: Ctx, lines: string[], x: number, y: number, size: number, p: Palette) {
  ctx.fillStyle = p.accent;
  ctx.fillRect(x, y, size, size);
  const inner = size * 0.76;
  const cx = x + size / 2;
  ctx.fillStyle = p.onAccent;
  const [first, second] = lines.map((line) => line.toLocaleUpperCase("en-US"));
  if (!second) {
    const s = sizeFor(ctx, first, inner, display, size * 0.4, size * 0.14);
    ctx.font = display(s);
    centered(ctx, first, cx, y + size / 2, inner);
    return;
  }
  const topSize = sizeFor(ctx, first, inner, display, size * 0.4, size * 0.2);
  const bottomSize = sizeFor(ctx, second, inner, display, size * 0.3, size * 0.12);
  const topCap = capHeight(ctx, display(topSize));
  const bottomCap = capHeight(ctx, display(bottomSize));
  const rule = Math.max(2, size * 0.025);
  const gap = size * 0.07;
  const block = topCap + gap * 2 + rule + bottomCap;
  let base = y + (size - block) / 2 + topCap;
  ctx.font = display(topSize);
  slanted(ctx, first, cx, base, "center");
  ctx.fillRect(x + (size - inner) / 2, base + gap, inner, rule);
  base += gap * 2 + rule + bottomCap;
  ctx.font = display(bottomSize);
  slanted(ctx, second, cx, base, "center");
}

/** Text leaning forward, as the posters set "VS" and the bout's billing. */
export function slanted(ctx: Ctx, value: string, x: number, y: number, align: CanvasTextAlign = "left", maxWidth?: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(1, 0, -0.2, 1, 0, 0);
  ctx.textAlign = align;
  const at = trackShift(ctx);
  if (maxWidth) ctx.fillText(value, at, 0, maxWidth);
  else ctx.fillText(value, at, 0);
  ctx.restore();
}

/** A photo filling a box, cropped from the top so the face stays in frame. */
export function coverTop(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / image.width, h / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, x + (w - dw) / 2, y + Math.min(0, (h - dh) * 0.12), dw, dh);
}

/** A cut-out cropped clean at the bottom of its box: the top `show` of the
 *  picture fills the box's height, or less when the box is too narrow. */
export function cutout(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number, align: "left" | "right" | "center", show = 1) {
  const scale = Math.min(w / image.width, h / (image.height * show));
  const dw = image.width * scale;
  const dh = image.height * scale;
  const dx = align === "left" ? x : align === "right" ? x + w - dw : x + (w - dw) / 2;
  const dy = y + h - dh * show;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.restore();
}

export type Outcome = "win" | "loss" | "draw" | "nc" | null;

const FORM_LETTER: Record<string, string> = { win: "W", loss: "L", draw: "D", nc: "NC" };
/** Last-five squares, oldest first, centred on `midY`. `x` is the left edge,
 *  or the centre or right per `align`. Returns the width taken. */
export function formSquares(ctx: Ctx, form: Outcome[], x: number, midY: number, size: number, p: Palette, align: "left" | "right" | "center"): number {
  const gap = size * 0.24;
  const total = formWidth(form, size);
  let start = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  for (const outcome of form) {
    ctx.fillStyle = outcome === "win" ? p.win : outcome === "loss" ? p.loss : outcome === "draw" ? p.draw : p.faint;
    roundRect(ctx, start, midY - size / 2, size, size, size * 0.18);
    ctx.fill();
    const letter = outcome ? FORM_LETTER[outcome] : "–";
    ctx.fillStyle = "#ffffff";
    ctx.font = text(800, size * (letter.length > 1 ? 0.42 : 0.56));
    centered(ctx, letter, start + size / 2, midY);
    start += size + gap;
  }
  ctx.textAlign = "left";
  return total;
}
export const formWidth = (form: Outcome[], size: number) => form.length * size + Math.max(0, form.length - 1) * size * 0.24;
