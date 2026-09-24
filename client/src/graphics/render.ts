/**
 * Share graphics, drawn on a canvas from data already on the page. Three
 * templates — two fighters side by side, one fighter, a whole card — each in
 * the three shapes social feeds use. Type is sized against the image's short
 * side so it survives a feed shrinking a 1080px image to a third of that, and
 * every image carries its source line, its date and the site's mark.
 */

export type Format = "square" | "portrait" | "landscape";
export type Theme = "dark" | "light";
export type Outcome = "win" | "loss" | "draw" | "nc" | null;

export const SIZES: Record<Format, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Square · 1080 × 1080" },
  portrait: { width: 1080, height: 1350, label: "Portrait · 1080 × 1350" },
  landscape: { width: 1600, height: 900, label: "Landscape · 1600 × 900" },
};

export type Photo = { image: HTMLImageElement; kind: "full" | "head" } | null;

export type Corner = {
  name: string;
  nickname?: string | null;
  photo: Photo;
  /** Short lines under the name: records, country. */
  lines: string[];
  badge?: string | null;
  outcome?: Outcome;
  /** "Won by KO/TKO · R2 3:10" on a result. */
  result?: string | null;
  form?: Outcome[] | null;
};

export type CompareRow = { shared?: string; label: string; f1: string; f2: string; edge: "f1" | "f2" | null };

export type VersusGraphic = {
  kind: "versus";
  eyebrow: string;
  title: string;
  subtitle: string;
  f1: Corner;
  f2: Corner;
  /** The prices between the two corners. */
  market?: { heading: string; f1: string; f2: string; note?: string | null } | null;
  sections: { title: string; rows: CompareRow[] }[];
  judges?: { name: string; f1: number; f2: number }[] | null;
  footer: Footer;
};

export type FighterGraphic = {
  kind: "fighter";
  eyebrow: string;
  name: string;
  nickname?: string | null;
  photo: Photo;
  badges: string[];
  facts: { label: string; value: string }[];
  stats: { label: string; value: string; rank?: string | null; detail?: string | null }[];
  form?: { outcome: Outcome; label: string }[] | null;
  footer: Footer;
};

export type CardGraphic = {
  kind: "card";
  eyebrow: string;
  title: string;
  subtitle: string;
  rows: {
    f1: string; f2: string; f1Sub?: string | null; f2Sub?: string | null;
    f1Odds?: string | null; f2Odds?: string | null; meta: string;
    winner?: "f1" | "f2" | null; result?: string | null; group?: string | null;
  }[];
  footer: Footer;
};

export type Footer = { url: string; notes: string[] };
export type Graphic = VersusGraphic | FighterGraphic | CardGraphic;

type Palette = {
  bg: string; bg2: string; ink: string; muted: string; faint: string; line: string; panel: string;
  f1: string; f2: string; win: string; loss: string; draw: string; gold: string; glow1: string; glow2: string;
};

const PALETTES: Record<Theme, Palette> = {
  dark: {
    bg: "#09090b", bg2: "#151518", ink: "#fafafa", muted: "#a1a1aa", faint: "#71717a", line: "rgba(255,255,255,0.09)", panel: "rgba(255,255,255,0.045)",
    f1: "#60a5fa", f2: "#f87171", win: "#10b981", loss: "#f43f5e", draw: "#f59e0b", gold: "#fbbf24",
    glow1: "rgba(59,130,246,0.22)", glow2: "rgba(239,68,68,0.20)",
  },
  light: {
    bg: "#ffffff", bg2: "#f4f4f5", ink: "#09090b", muted: "#52525b", faint: "#71717a", line: "rgba(0,0,0,0.08)", panel: "rgba(0,0,0,0.035)",
    f1: "#1d4ed8", f2: "#b91c1c", win: "#059669", loss: "#e11d48", draw: "#d97706", gold: "#a16207",
    glow1: "rgba(59,130,246,0.12)", glow2: "rgba(239,68,68,0.10)",
  },
};

const FONT = `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px ${FONT}`;

type Ctx = CanvasRenderingContext2D;

/** Write `text` no wider than `width`, shrinking to `min` before truncating. */
function fit(ctx: Ctx, text: string, x: number, y: number, width: number, weight: number, size: number, min = size * 0.7): number {
  let current = size;
  ctx.font = font(weight, current);
  while (ctx.measureText(text).width > width && current > min) {
    current -= 1;
    ctx.font = font(weight, current);
  }
  let shown = text;
  if (ctx.measureText(shown).width > width) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > width) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  ctx.fillText(shown, x, y);
  return current;
}

function tracked(ctx: Ctx, text: string, x: number, y: number, spacing: number) {
  // Canvas letterSpacing is not everywhere yet; set it where it exists.
  const withSpacing = ctx as Ctx & { letterSpacing?: string };
  if ("letterSpacing" in withSpacing) {
    withSpacing.letterSpacing = `${spacing}px`;
    ctx.fillText(text, x, y);
    withSpacing.letterSpacing = "0px";
  } else ctx.fillText(text, x, y);
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function background(ctx: Ctx, w: number, h: number, p: Palette, split: boolean) {
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, w, h);
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, p.bg2);
  wash.addColorStop(1, p.bg);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);
  const glow = (x: number, color: string) => {
    const gradient = ctx.createRadialGradient(x, h * 0.35, 0, x, h * 0.35, Math.max(w, h) * 0.55);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  };
  glow(split ? w * 0.12 : w * 0.25, p.glow1);
  if (split) glow(w * 0.88, p.glow2);
}

/** A full-body cut-out standing on the bottom of its box, fading out before
 *  the crop line; a headshot in a ringed circle. */
function drawPhoto(ctx: Ctx, photo: Photo, x: number, y: number, w: number, h: number, ring: string, align: "center" | "left" | "right" = "center") {
  if (!photo) return;
  const { image } = photo;
  if (photo.kind === "head") {
    const size = Math.min(w, h);
    const cx = align === "left" ? x + size / 2 : align === "right" ? x + w - size / 2 : x + w / 2;
    const cy = y + h / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const scale = Math.max(size / image.width, size / image.height);
    ctx.drawImage(image, cx - (image.width * scale) / 2, cy - (image.height * scale) / 2, image.width * scale, image.height * scale);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(3, size * 0.025);
    ctx.strokeStyle = ring;
    ctx.stroke();
    return;
  }
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
  fade.addColorStop(0.72, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  lctx.fillStyle = fade;
  lctx.fillRect(0, 0, layer.width, layer.height);
  ctx.drawImage(layer, dx, dy);
}

function formDots(ctx: Ctx, form: Outcome[], x: number, y: number, size: number, p: Palette, align: "left" | "right" | "center") {
  const gap = size * 0.35;
  const total = form.length * size + (form.length - 1) * gap;
  let start = align === "left" ? x : align === "right" ? x - total : x - total / 2;
  for (const outcome of form) {
    const color = outcome === "win" ? p.win : outcome === "loss" ? p.loss : outcome === "draw" ? p.draw : p.faint;
    roundRect(ctx, start, y, size, size, size * 0.28);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = font(800, size * 0.58);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(outcome === "win" ? "W" : outcome === "loss" ? "L" : outcome === "draw" ? "D" : "–", start + size / 2, y + size / 2 + 1);
    start += size + gap;
  }
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
}

/** The mark and the source line, identical on every template. */
function footer(ctx: Ctx, w: number, h: number, u: number, pad: number, p: Palette, data: Footer) {
  const base = h - pad;
  ctx.strokeStyle = p.line;
  ctx.lineWidth = Math.max(1, u);
  ctx.beginPath();
  ctx.moveTo(pad, base - 58 * u);
  ctx.lineTo(w - pad, base - 58 * u);
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = p.ink;
  ctx.font = font(800, 34 * u);
  ctx.fillText("UFC", pad, base - 12 * u);
  const ufc = ctx.measureText("UFC").width;
  ctx.fillStyle = p.muted;
  ctx.font = font(700, 34 * u);
  ctx.fillText(".sh", pad + ufc, base - 12 * u);
  const mark = ufc + ctx.measureText(".sh").width;
  ctx.font = font(500, 17 * u);
  ctx.fillStyle = p.faint;
  ctx.fillText(data.url, pad + mark + 14 * u, base - 14 * u);
  ctx.textAlign = "right";
  const notes = data.notes.slice(0, 2);
  notes.forEach((note, index) => {
    ctx.font = font(500, 16 * u);
    ctx.fillStyle = p.faint;
    fit(ctx, note, w - pad, base - 12 * u - (notes.length - 1 - index) * 21 * u, w * 0.55, 500, 16 * u, 12 * u);
  });
  ctx.textAlign = "left";
}

function header(ctx: Ctx, w: number, u: number, pad: number, p: Palette, eyebrow: string, title: string, subtitle: string, align: "left" | "center") {
  const x = align === "center" ? w / 2 : pad;
  ctx.textAlign = align;
  ctx.fillStyle = p.gold;
  ctx.font = font(700, 19 * u);
  tracked(ctx, eyebrow.toUpperCase(), x, pad + 20 * u, 3 * u);
  ctx.fillStyle = p.ink;
  fit(ctx, title, x, pad + 74 * u, w - pad * 2, 800, 52 * u, 30 * u);
  ctx.fillStyle = p.muted;
  fit(ctx, subtitle, x, pad + 108 * u, w - pad * 2, 500, 22 * u, 15 * u);
  ctx.textAlign = "left";
  return pad + 130 * u;
}

// ---------------------------------------------------------------------------

function renderVersus(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: VersusGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = Math.round(48 * u);
  background(ctx, w, h, p, true);
  const top = header(ctx, w, u, pad, p, g.eyebrow, g.title, g.subtitle, "center");
  const bottom = h - pad - 72 * u;
  const rows = g.sections.flatMap((section) => [{ heading: section.title }, ...section.rows.map((row) => ({ row }))]);
  const judges = g.judges ?? [];
  const wide = format === "landscape";

  // Corner blocks: pictures, then names, records and form. The table takes
  // what its rows need and the pictures take the rest, within limits.
  const tableNeed = rows.length * 52 * u + (judges.length ? 118 * u : 0) + 16 * u;
  const cornerH = wide ? bottom - top
    : Math.max((bottom - top) * (format === "portrait" ? 0.54 : 0.5), Math.min((bottom - top) * (format === "portrait" ? 0.66 : 0.62), bottom - top - tableNeed));
  const photoW = wide ? w * 0.25 : w * 0.38;
  const hasFull = [g.f1.photo, g.f2.photo].some((photo) => photo?.kind === "full");
  const extraLines = Math.max(...[g.f1, g.f2].map((c) => (c.nickname ? 1 : 0) + c.lines.length + (c.result ? 1.3 : 0) + (c.form?.length ? 1.2 : 0) + (g.market && !wide ? 1.4 : 0)));
  const nameBlock = 60 * u + extraLines * 30 * u;
  // A cut-out fades out over its last quarter, so the names can stand on it.
  const base = Math.max(120 * u, cornerH - nameBlock);
  const overlap = hasFull ? Math.min(nameBlock * 0.55, base * 0.3) : 0;
  const photoH = wide ? cornerH * 0.78 : hasFull ? base + overlap : base * 0.8;
  const photoTop = top + (wide ? cornerH - photoH - 150 * u : 6 * u);
  const sides: ["f1" | "f2", Corner, number][] = [["f1", g.f1, pad], ["f2", g.f2, w - pad - photoW]];
  for (const [side, corner, x] of sides) {
    const color = side === "f1" ? p.f1 : p.f2;
    if (corner.photo) {
      ctx.save();
      if (corner.outcome === "loss") ctx.globalAlpha = 0.72;
      drawPhoto(ctx, corner.photo, x, photoTop, photoW, photoH, color, corner.photo.kind === "head" || !wide ? "center" : side === "f1" ? "left" : "right");
      ctx.restore();
    }
    const align: CanvasTextAlign = "center";
    const cx = x + photoW / 2;
    let y = (corner.photo ? photoTop + photoH - (corner.photo.kind === "full" && !wide ? overlap : 0) : photoTop + 30 * u) + 44 * u;
    ctx.shadowColor = p.bg;
    ctx.shadowBlur = 18 * u;
    if (corner.badge) {
      ctx.font = font(800, 18 * u);
      const text = corner.badge;
      const bw = ctx.measureText(text).width + 22 * u;
      roundRect(ctx, cx - bw / 2, y - 60 * u, bw, 30 * u, 8 * u);
      ctx.fillStyle = text === "C" || text.startsWith("Champion") ? p.gold : p.panel;
      ctx.fill();
      ctx.fillStyle = text === "C" || text.startsWith("Champion") ? "#111" : p.ink;
      ctx.textAlign = "center";
      ctx.fillText(text, cx, y - 38 * u);
    }
    ctx.textAlign = align;
    ctx.fillStyle = corner.outcome === "loss" ? p.muted : color;
    fit(ctx, corner.name, cx, y, photoW + (wide ? 0 : pad * 0.6), 800, 40 * u, 24 * u);
    y += 30 * u;
    if (corner.nickname) {
      ctx.fillStyle = p.faint;
      fit(ctx, `“${corner.nickname}”`, cx, y, photoW, 500, 20 * u, 14 * u);
      y += 28 * u;
    }
    for (const line of corner.lines) {
      ctx.fillStyle = p.muted;
      fit(ctx, line, cx, y, photoW, 600, 21 * u, 14 * u);
      y += 28 * u;
    }
    if (g.market && !wide) {
      const price = side === "f1" ? g.market.f1 : g.market.f2;
      ctx.font = font(800, 26 * u);
      const label = `${price}`;
      const pw = ctx.measureText(label).width + 28 * u;
      roundRect(ctx, cx - pw / 2, y - 24 * u, pw, 36 * u, 18 * u);
      ctx.fillStyle = p.panel;
      ctx.fill();
      ctx.fillStyle = color;
      ctx.textAlign = "center";
      ctx.fillText(label, cx, y + 3 * u);
      y += 40 * u;
    }
    if (corner.result) {
      ctx.font = font(800, 18 * u);
      const text = corner.result.toUpperCase();
      const tw = Math.min(ctx.measureText(text).width + 24 * u, photoW);
      roundRect(ctx, cx - tw / 2, y - 20 * u, tw, 32 * u, 16 * u);
      ctx.fillStyle = corner.outcome === "win" ? p.win : corner.outcome === "draw" ? p.draw : p.panel;
      ctx.fill();
      ctx.fillStyle = corner.outcome === "win" || corner.outcome === "draw" ? "#fff" : p.muted;
      ctx.textAlign = "center";
      fit(ctx, text, cx, y + 3 * u, tw - 16 * u, 800, 18 * u, 12 * u);
      y += 38 * u;
    }
    ctx.shadowBlur = 0;
    if (corner.form?.length) formDots(ctx, corner.form, cx, y - 6 * u, 26 * u, p, "center");
  }

  // The market between them.
  const midX = w / 2;
  let midY = wide ? top + 30 * u : photoTop + photoH * 0.42;
  if (g.market && !wide) {
    ctx.textAlign = "center";
    ctx.fillStyle = p.faint;
    ctx.font = font(900, 44 * u);
    ctx.fillText("VS", midX, midY + 20 * u);
    ctx.font = font(700, 15 * u);
    tracked(ctx, g.market.heading.toUpperCase(), midX, midY + 52 * u, 2 * u);
  } else if (g.market) {
    ctx.textAlign = "center";
    ctx.fillStyle = p.faint;
    ctx.font = font(700, 16 * u);
    tracked(ctx, g.market.heading.toUpperCase(), midX, midY, 2 * u);
    const boxW = wide ? 300 * u : Math.min(260 * u, w - photoW * 2 - pad * 2);
    roundRect(ctx, midX - boxW / 2, midY + 14 * u, boxW, 74 * u, 16 * u);
    ctx.fillStyle = p.panel;
    ctx.fill();
    ctx.font = font(800, 34 * u);
    ctx.fillStyle = p.f1;
    ctx.textAlign = "left";
    ctx.fillText(g.market.f1, midX - boxW / 2 + 18 * u, midY + 64 * u);
    ctx.fillStyle = p.f2;
    ctx.textAlign = "right";
    ctx.fillText(g.market.f2, midX + boxW / 2 - 18 * u, midY + 64 * u);
    if (g.market.note) {
      ctx.textAlign = "center";
      ctx.fillStyle = p.faint;
      fit(ctx, g.market.note, midX, midY + 114 * u, boxW + 80 * u, 500, 15 * u, 11 * u);
    }
    midY += 130 * u;
  } else if (!wide) {
    ctx.textAlign = "center";
    ctx.fillStyle = p.faint;
    ctx.font = font(900, 44 * u);
    ctx.fillText("VS", midX, midY + 20 * u);
  }

  // The comparison table.
  const tableTop = wide ? midY + 8 * u : top + cornerH + 12 * u;
  const tableBottom = bottom;
  const tableX = wide ? pad + photoW + 24 * u : pad;
  const tableW = wide ? w - (pad + photoW + 24 * u) * 2 : w - pad * 2;
  const judgeBlock = judges.length ? 118 * u : 0;
  const available = tableBottom - tableTop - judgeBlock;
  const rowH = rows.length ? Math.min(54 * u, available / rows.length) : 0;
  const scale = Math.min(1, rowH / (54 * u));
  let y = tableTop;
  for (const entry of rows) {
    if ("heading" in entry) {
      ctx.textAlign = "center";
      ctx.fillStyle = p.gold;
      ctx.font = font(800, 15 * u * Math.max(scale, 0.8));
      tracked(ctx, entry.heading.toUpperCase(), tableX + tableW / 2, y + rowH * 0.66, 2 * u);
      y += rowH;
      continue;
    }
    const row = entry.row;
    ctx.strokeStyle = p.line;
    ctx.lineWidth = Math.max(1, u);
    ctx.beginPath();
    ctx.moveTo(tableX, y);
    ctx.lineTo(tableX + tableW, y);
    ctx.stroke();
    const baseline = y + rowH * 0.64;
    if (row.shared) {
      ctx.textAlign = "left";
      ctx.fillStyle = p.muted;
      fit(ctx, row.label, tableX + 10 * u, baseline, tableW * 0.78, 600, 20 * u * Math.max(scale, 0.75), 14 * u);
      ctx.textAlign = "right";
      ctx.fillStyle = p.ink;
      fit(ctx, row.shared, tableX + tableW - 10 * u, baseline, tableW * 0.18, 700, 27 * u * Math.max(scale, 0.7), 14 * u);
      y += rowH;
      continue;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = p.muted;
    fit(ctx, row.label.toUpperCase(), tableX + tableW / 2, baseline, tableW * 0.36, 700, 17 * u * Math.max(scale, 0.75), 11 * u);
    for (const side of ["f1", "f2"] as const) {
      const edge = row.edge === side;
      ctx.fillStyle = edge ? (side === "f1" ? p.f1 : p.f2) : p.ink;
      ctx.textAlign = side === "f1" ? "left" : "right";
      const x = side === "f1" ? tableX + 10 * u : tableX + tableW - 10 * u;
      fit(ctx, row[side], x, baseline, tableW * 0.3, edge ? 800 : 600, 27 * u * Math.max(scale, 0.7), 14 * u);
      if (edge) {
        ctx.beginPath();
        const dotX = side === "f1" ? x - 2 * u : x + 2 * u;
        ctx.arc(side === "f1" ? dotX - 8 * u : dotX + 8 * u, baseline - 9 * u, 4 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    y += rowH;
  }

  if (judges.length) {
    const jy = tableBottom - judgeBlock + 20 * u;
    ctx.textAlign = "center";
    ctx.fillStyle = p.gold;
    ctx.font = font(800, 15 * u);
    tracked(ctx, "JUDGES’ SCORECARDS", tableX + tableW / 2, jy, 2 * u);
    const colW = tableW / judges.length;
    judges.forEach((judge, index) => {
      const cx = tableX + colW * index + colW / 2;
      ctx.fillStyle = p.muted;
      fit(ctx, judge.name, cx, jy + 34 * u, colW - 12 * u, 600, 18 * u, 12 * u);
      ctx.font = font(800, 36 * u);
      const left = String(judge.f1);
      const right = String(judge.f2);
      ctx.textAlign = "right";
      ctx.fillStyle = judge.f1 > judge.f2 ? p.f1 : p.faint;
      ctx.fillText(left, cx - 8 * u, jy + 80 * u);
      ctx.textAlign = "center";
      ctx.fillStyle = p.faint;
      ctx.fillText("–", cx, jy + 80 * u);
      ctx.textAlign = "left";
      ctx.fillStyle = judge.f2 > judge.f1 ? p.f2 : p.faint;
      ctx.fillText(right, cx + 8 * u, jy + 80 * u);
      ctx.textAlign = "center";
    });
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

function renderFighter(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: FighterGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = Math.round(48 * u);
  background(ctx, w, h, p, false);
  const bottom = h - pad - 72 * u;
  const hasPhoto = Boolean(g.photo);
  const photoW = hasPhoto ? (format === "landscape" ? w * 0.36 : w * 0.42) : 0;
  const textX = hasPhoto ? pad + photoW + 20 * u : pad;
  const textW = w - textX - pad;
  if (g.photo) {
    if (g.photo.kind === "full") drawPhoto(ctx, g.photo, pad - 10 * u, pad + 20 * u, photoW, bottom - pad - 10 * u, p.f1, "left");
    else drawPhoto(ctx, g.photo, pad, pad + 40 * u, photoW - 20 * u, photoW - 20 * u, p.f1, "center");
  }
  let y = pad + 24 * u;
  ctx.textAlign = "left";
  ctx.fillStyle = p.gold;
  ctx.font = font(700, 19 * u);
  tracked(ctx, g.eyebrow.toUpperCase(), textX, y, 3 * u);
  y += 62 * u;
  ctx.fillStyle = p.ink;
  const size = fit(ctx, g.name, textX, y, textW, 800, 64 * u, 34 * u);
  y += size * 0.2;
  if (g.nickname) {
    y += 34 * u;
    ctx.fillStyle = p.muted;
    fit(ctx, `“${g.nickname}”`, textX, y, textW, 500, 26 * u, 16 * u);
  }
  y += 26 * u;
  let bx = textX;
  for (const badge of g.badges) {
    ctx.font = font(800, 19 * u);
    const bw = ctx.measureText(badge).width + 26 * u;
    if (bx + bw > textX + textW) { bx = textX; y += 44 * u; }
    roundRect(ctx, bx, y, bw, 36 * u, 18 * u);
    ctx.fillStyle = badge.startsWith("Champion") || badge.startsWith("Interim") ? p.gold : p.panel;
    ctx.fill();
    ctx.fillStyle = badge.startsWith("Champion") || badge.startsWith("Interim") ? "#111" : p.ink;
    ctx.fillText(badge, bx + 13 * u, y + 25 * u);
    bx += bw + 10 * u;
  }
  if (g.badges.length) y += 58 * u;
  if (g.facts.length) {
    const cols = Math.min(g.facts.length, format === "landscape" ? 4 : 2);
    const colW = textW / cols;
    g.facts.forEach((fact, index) => {
      const cx = textX + (index % cols) * colW;
      const cy = y + Math.floor(index / cols) * 66 * u;
      ctx.fillStyle = p.faint;
      ctx.font = font(700, 15 * u);
      tracked(ctx, fact.label.toUpperCase(), cx, cy + 16 * u, 1.5 * u);
      ctx.fillStyle = p.ink;
      fit(ctx, fact.value, cx, cy + 48 * u, colW - 12 * u, 700, 28 * u, 16 * u);
    });
    y += Math.ceil(g.facts.length / cols) * 66 * u + 10 * u;
  }
  if (g.form?.length) {
    ctx.fillStyle = p.faint;
    ctx.font = font(700, 15 * u);
    tracked(ctx, "LAST FIVE", textX, y + 16 * u, 1.5 * u);
    formDots(ctx, g.form.map((entry) => entry.outcome), textX, y + 28 * u, 34 * u, p, "left");
    ctx.fillStyle = p.muted;
    fit(ctx, g.form.map((entry) => entry.label).join(" · "), textX, y + 90 * u, textW, 500, 17 * u, 11 * u);
    y += 116 * u;
  }
  if (g.stats.length) {
    const rowH = Math.min(62 * u, (bottom - y - 10 * u) / g.stats.length);
    const scale = Math.min(1, rowH / (62 * u));
    for (const stat of g.stats) {
      ctx.strokeStyle = p.line;
      ctx.beginPath();
      ctx.moveTo(textX, y);
      ctx.lineTo(textX + textW, y);
      ctx.stroke();
      let lx = textX;
      if (stat.rank) {
        ctx.font = font(800, 18 * u * Math.max(scale, 0.75));
        const bw = Math.max(58 * u * scale, ctx.measureText(stat.rank).width + 18 * u);
        roundRect(ctx, textX, y + rowH * 0.2, bw, rowH * 0.6, 8 * u);
        ctx.fillStyle = stat.rank === "#1" || stat.rank === "#T1" ? p.gold : p.panel;
        ctx.fill();
        ctx.fillStyle = stat.rank === "#1" || stat.rank === "#T1" ? "#111" : p.ink;
        ctx.textAlign = "center";
        ctx.fillText(stat.rank, textX + bw / 2, y + rowH * 0.58);
        ctx.textAlign = "left";
        lx += bw + 14 * u;
      }
      ctx.fillStyle = p.ink;
      fit(ctx, stat.label, lx, y + rowH * (stat.detail ? 0.46 : 0.62), textW * 0.62 - (lx - textX), 700, 22 * u * Math.max(scale, 0.7), 12 * u);
      if (stat.detail) {
        ctx.fillStyle = p.faint;
        fit(ctx, stat.detail, lx, y + rowH * 0.8, textW * 0.62 - (lx - textX), 500, 15 * u * Math.max(scale, 0.7), 10 * u);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = p.ink;
      fit(ctx, stat.value, textX + textW, y + rowH * 0.64, textW * 0.34, 800, 28 * u * Math.max(scale, 0.7), 14 * u);
      ctx.textAlign = "left";
      y += rowH;
    }
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

function renderCard(ctx: Ctx, w: number, h: number, _format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = Math.round(48 * u);
  background(ctx, w, h, p, true);
  const top = header(ctx, w, u, pad, p, g.eyebrow, g.title, g.subtitle, "center") + 10 * u;
  const bottom = h - pad - 80 * u;
  const groups = g.rows.reduce((count, row, index) => count + (row.group && row.group !== g.rows[index - 1]?.group ? 1 : 0), 0);
  const slots = g.rows.length + groups * 0.7;
  const rowH = Math.min(118 * u, (bottom - top) / Math.max(1, slots));
  const scale = Math.min(1, rowH / (92 * u));
  const x0 = pad;
  const x1 = w - pad;
  const mid = w / 2;
  // A short card sits in the middle of the space rather than hanging from the top.
  let y = top + Math.max(0, (bottom - top - rowH * slots) / 2);
  g.rows.forEach((row, index) => {
    if (row.group && row.group !== g.rows[index - 1]?.group) {
      ctx.textAlign = "center";
      ctx.fillStyle = p.gold;
      ctx.font = font(800, 16 * u * Math.max(scale, 0.8));
      tracked(ctx, row.group.toUpperCase(), mid, y + rowH * 0.5, 2 * u);
      y += rowH * 0.7;
    }
    roundRect(ctx, x0, y + 4 * u, x1 - x0, rowH - 8 * u, 14 * u * scale);
    ctx.fillStyle = p.panel;
    ctx.fill();
    const nameSize = 30 * u * Math.max(scale, 0.62);
    const subSize = 17 * u * Math.max(scale, 0.7);
    const nameY = y + rowH * (row.f1Sub || row.f2Sub ? 0.46 : 0.6);
    const subY = y + rowH * 0.78;
    const oddsW = row.f1Odds || row.f2Odds ? 110 * u * Math.max(scale, 0.7) : 0;
    for (const side of ["f1", "f2"] as const) {
      const winner = row.winner === side;
      const loser = row.winner && !winner;
      const left = side === "f1";
      const nameX = left ? x0 + 22 * u : x1 - 22 * u;
      ctx.textAlign = left ? "left" : "right";
      ctx.fillStyle = loser ? p.faint : side === "f1" ? p.f1 : p.f2;
      fit(ctx, row[side], nameX, nameY, (mid - x0) - oddsW - 110 * u, winner ? 800 : 700, nameSize, 13 * u);
      const sub = side === "f1" ? row.f1Sub : row.f2Sub;
      if (sub) {
        ctx.fillStyle = p.faint;
        fit(ctx, sub, nameX, subY, (mid - x0) - oddsW - 110 * u, 500, subSize, 10 * u);
      }
      const odds = side === "f1" ? row.f1Odds : row.f2Odds;
      if (odds) {
        ctx.textAlign = left ? "right" : "left";
        ctx.fillStyle = p.ink;
        ctx.font = font(800, 24 * u * Math.max(scale, 0.65));
        ctx.fillText(odds, left ? mid - 88 * u * Math.max(scale, 0.6) : mid + 88 * u * Math.max(scale, 0.6), y + rowH * 0.6);
      }
    }
    ctx.textAlign = "center";
    ctx.fillStyle = row.result ? p.win : p.faint;
    fit(ctx, row.result ?? "vs", mid, y + rowH * (row.meta ? 0.46 : 0.6), 150 * u, 800, 18 * u * Math.max(scale, 0.7), 10 * u);
    if (row.meta) {
      ctx.fillStyle = p.faint;
      fit(ctx, row.meta, mid, y + rowH * 0.76, 170 * u, 500, 14 * u * Math.max(scale, 0.7), 9 * u);
    }
    y += rowH;
  });
  footer(ctx, w, h, u, pad, p, g.footer);
}

export function renderGraphic(canvas: HTMLCanvasElement, graphic: Graphic, format: Format, theme: Theme) {
  const { width, height } = SIZES[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  const palette = PALETTES[theme];
  if (graphic.kind === "versus") renderVersus(ctx, width, height, format, palette, graphic);
  else if (graphic.kind === "fighter") renderFighter(ctx, width, height, format, palette, graphic);
  else renderCard(ctx, width, height, format, palette, graphic);
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** A same-origin picture, so the canvas stays exportable. Null when it fails. */
export function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let pending = imageCache.get(url);
  if (!pending) {
    pending = new Promise((resolve) => {
      const image = new Image();
      image.decoding = "async";
      const timeout = setTimeout(() => { imageCache.delete(url); resolve(null); }, 8000);
      image.onload = () => { clearTimeout(timeout); resolve(image.naturalWidth > 1 ? image : null); };
      image.onerror = () => { clearTimeout(timeout); imageCache.delete(url); resolve(null); };
      image.crossOrigin = "anonymous";
      image.src = url;
    });
    if (imageCache.size >= 32) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(url, pending);
  }
  return pending;
}
