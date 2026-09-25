import {
  backdrop, cond, coverTop, cutout, fit, flag, flagWidth, footer, formSquares, label, mark, octagon, PALETTES, pill, rankBox, rankWidth,
  roundel, roundRect, sans, sizeFor, splitBar, spacing,
  type Ctx, type Footer, type Outcome, type Palette, type Split, type Theme,
} from "./draw";

/**
 * Share graphics, drawn on a canvas from data already on the page, in the
 * style of a fight poster: heavy condensed capitals, rank boxes, flags and a
 * textured backdrop. Five templates — two fighters, one fighter, a card as a
 * bout list or a wall of faces, and a bet slip — each in the three shapes
 * social feeds use. Type is sized against the image's short side so it
 * survives a feed shrinking it, and every image carries its sources, its
 * date and the site's mark.
 */

export type { Footer, Outcome, Split, Theme };
export type Format = "square" | "portrait" | "landscape";

export const SIZES: Record<Format, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Square · 1080 × 1080" },
  portrait: { width: 1080, height: 1350, label: "Portrait · 1080 × 1350" },
  landscape: { width: 1600, height: 900, label: "Landscape · 1600 × 900" },
};

export const THEMES: { value: Theme; label: string }[] = [
  { value: "red", label: "Red" }, { value: "gold", label: "Gold" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" },
];

export type Photo = { image: HTMLImageElement; kind: "full" | "head" } | null;

/** Someone's call on a bout, and how it stands. */
export type PickMark = { side: "f1" | "f2"; detail: string | null; state: "pending" | "won" | "lost" | "void" };

export type Corner = {
  name: string;
  /** What the poster prints big: "ROSAS JR.". */
  surname: string;
  nickname?: string | null;
  photo: Photo;
  /** "12", "C" or "IC", drawn as a box beside the name. */
  rank?: string | null;
  flag?: string | null;
  /** Short lines under the name: records. */
  lines: string[];
  odds?: string | null;
  outcome?: Outcome;
  /** "Won · KO/TKO · R2 3:10" on a result. */
  result?: string | null;
  form?: Outcome[] | null;
};

export type CompareRow = { shared?: string; label: string; f1: string; f2: string; edge: "f1" | "f2" | null };

export type VersusGraphic = {
  kind: "versus";
  eyebrow: string;
  /** "Bantamweight bout", "Lightweight title". */
  label: string;
  subtitle: string;
  title: string;
  f1: Corner;
  f2: Corner;
  /** Named between the two prices when the corners carry odds. */
  marketHeading?: string | null;
  pick?: (PickMark & { heading: string }) | null;
  splits: Split[];
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
  rank?: string | null;
  flag?: string | null;
  badges: string[];
  facts: { label: string; value: string }[];
  stats: { label: string; value: string; rank?: string | null; detail?: string | null }[];
  form?: { outcome: Outcome; label: string }[] | null;
  footer: Footer;
};

export type CardSide = { name: string; surname: string; sub?: string | null; odds?: string | null; rank?: string | null; flag?: string | null; photo: Photo };
export type CardRow = {
  f1: CardSide; f2: CardSide;
  /** "Bantamweight bout". */
  meta: string;
  title: boolean;
  winner?: "f1" | "f2" | null;
  result?: string | null;
  group?: string | null;
  pick?: PickMark | null;
  splits: Split[];
};

export type CardGraphic = {
  kind: "card";
  layout: "list" | "faces";
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The poster's date line: "SEP 26 SAT", and where and when under it. */
  date: { big: string; small: string };
  rows: CardRow[];
  footer: Footer;
};

export type BetLegState = "pending" | "won" | "lost" | "void";
export type ParlayGraphic = {
  kind: "parlay";
  eyebrow: string;
  title: string;
  price: string;
  state: BetLegState;
  stake: string;
  payout: string;
  net: string | null;
  placed: string;
  legs: { selection: string; bout: string; event: string; price: string; state: BetLegState }[];
  footer: Footer;
};

export type Graphic = VersusGraphic | FighterGraphic | CardGraphic | ParlayGraphic;

const upper = (text: string) => text.toLocaleUpperCase("en-US");
/** Right is green and wrong is red whatever the theme; an open pick is plain ink,
 *  so the red theme's accent is never mistaken for a miss. */
const stateColor = (p: Palette, state: BetLegState | PickMark["state"]) => state === "won" ? p.win : state === "lost" ? p.loss : state === "void" ? p.faint : p.ink;
const stateInk = (p: Palette, state: BetLegState | PickMark["state"]) => state === "pending" ? p.bg : "#ffffff";
const stateMark = (state: BetLegState | PickMark["state"]): "check" | "cross" | "dot" => state === "won" ? "check" : state === "lost" ? "cross" : "dot";

/** Eyebrow, headline and a line under it, centred between `x0` and `x1`.
 *  Returns the baseline of the last line drawn. */
function masthead(ctx: Ctx, u: number, top: number, p: Palette, x0: number, x1: number, eyebrow: string, title: string, subtitle: string, titleSize: number) {
  const cx = (x0 + x1) / 2;
  const width = x1 - x0;
  ctx.textAlign = "center";
  ctx.fillStyle = p.accent;
  label(ctx, upper(eyebrow), cx, top + 22 * u, cond(800, 24 * u), 3 * u, width);
  ctx.fillStyle = p.ink;
  const size = sizeFor(ctx, upper(title), width, (s) => cond(800, s), titleSize, titleSize * 0.45);
  const titleBase = top + 30 * u + size * 0.78;
  fit(ctx, upper(title), cx, titleBase, width, (s) => cond(800, s), size, size);
  if (!subtitle) return titleBase;
  ctx.fillStyle = p.muted;
  fit(ctx, subtitle, cx, titleBase + 34 * u, width, (s) => sans(500, s), 20 * u, 13 * u);
  return titleBase + 34 * u;
}

// ---------------------------------------------------------------------------
// Two fighters

function renderVersus(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: VersusGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 46 * u;
  const wide = format === "landscape";
  backdrop(ctx, w, h, p, true);
  const footTop = h - pad - 54 * u;
  const colX0 = wide ? w * 0.285 : pad;
  const colX1 = wide ? w * 0.715 : w - pad;
  const colW = colX1 - colX0;
  const cx = (colX0 + colX1) / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = p.accent;
  label(ctx, upper(g.eyebrow), cx, pad + 22 * u, cond(800, 24 * u), 3 * u, colW);
  ctx.fillStyle = p.ink;
  label(ctx, upper(g.label), cx, pad + 60 * u, cond(800, 32 * u, true), 4 * u, colW);
  ctx.fillStyle = p.muted;
  fit(ctx, g.subtitle, cx, pad + 90 * u, colW, (s) => sans(500, s), 19 * u, 12 * u);
  const top = pad + 104 * u;

  // What sits under the fighters decides how much room they get.
  const rows = g.sections.flatMap((section) => [{ heading: section.title } as const, ...section.rows.map((row) => ({ row }))]);
  const judges = g.judges ?? [];
  const judgeNeed = judges.length ? 128 * u : 0;
  const tableNeed = rows.reduce((sum, entry) => sum + ("heading" in entry ? 40 : 46) * u, 0) + judgeNeed + (rows.length || judges.length ? 8 * u : 0);
  const bandNeed = (g.pick ? 80 * u : 0) + g.splits.length * 88 * u;
  const corners = [g.f1, g.f2];
  const infoLines = Math.max(...corners.map((c) => (c.nickname ? 1 : 0) + (c.lines.length ? 1 : 0) + (c.odds || c.result || c.form?.length ? 1 : 0)));
  const infoH = infoLines ? 12 * u + infoLines * 40 * u : 0;
  const hasPhotos = corners.some((c) => c.photo);
  const space = footTop - 12 * u - top;
  const minHero = space * (hasPhotos && !wide ? 0.46 : 0.3);
  let heroH = space - tableNeed - bandNeed;
  let tableScale = 1;
  if (heroH < minHero) {
    heroH = minHero;
    tableScale = tableNeed ? Math.max(0.5, (space - heroH - bandNeed) / tableNeed) : 1;
  }
  const heroBottom = top + heroH;

  // The names, stacked in the middle as the posters set them.
  const nameWidth = wide ? colW : w - pad * 2;
  const names = corners.map((c) => upper(c.surname));
  const extras = (index: number, size: number) => {
    const c = corners[index];
    const rank = c.rank ? rankWidth(ctx, c.rank, size * 0.56) + size * 0.14 : 0;
    const flagged = flagWidth(ctx, c.flag, size * 0.46);
    const picked = g.pick?.side === (index === 0 ? "f1" : "f2") ? size * 0.5 : 0;
    return rank + (flagged ? flagged + size * 0.14 : 0) + picked;
  };
  const infoRoom = infoH + 6 * u;
  const heads = corners.some((c) => c.photo?.kind === "head");
  const blockRoom = hasPhotos && !wide ? heads ? (heroH - infoRoom) * 0.44 : heroH * 0.5 : heroH - infoRoom - 6 * u;
  let size = Math.min(wide ? 104 * u : hasPhotos ? 124 * u : 150 * u, blockRoom / (0.86 * 2 + 0.44));
  const lineWidth = (index: number, s: number) => { ctx.font = cond(800, s); return ctx.measureText(names[index]).width + extras(index, s); };
  while (size > 34 * u && Math.max(lineWidth(0, size), lineWidth(1, size)) > nameWidth) size -= 2 * u;
  const vsSize = size * 0.34;
  const blockH = size * 0.86 * 2 + vsSize * 1.3;
  const blockBottom = hasPhotos && !wide ? heroBottom - infoRoom : top + (heroH - infoRoom - blockH) / 2 + blockH;
  const baselines = [blockBottom - blockH + size * 0.86, blockBottom];
  // Pictures, over a faint octagon.
  if (hasPhotos) {
    ctx.save();
    ctx.strokeStyle = p.accent;
    const oy = wide ? (pad + footTop) / 2 : top + heroH * 0.46;
    const or = wide ? h * 0.4 : Math.min(w * 0.4, heroH * 0.56);
    ctx.globalAlpha = 0.2;
    ctx.lineWidth = 6 * u;
    octagon(ctx, w / 2, oy, or);
    ctx.stroke();
    ctx.globalAlpha = 0.09;
    ctx.lineWidth = 3 * u;
    octagon(ctx, w / 2, oy, or * 0.84);
    ctx.stroke();
    ctx.restore();
  }
  for (const [side, corner] of [["f1", g.f1], ["f2", g.f2]] as const) {
    const photo = corner.photo;
    if (!photo) continue;
    ctx.save();
    if (corner.outcome === "loss" || (g.pick && g.pick.side !== side)) ctx.globalAlpha = corner.outcome === "loss" ? 0.5 : 0.8;
    if (photo.kind === "full") {
      if (wide) cutout(ctx, photo.image, side === "f1" ? 0 : w * 0.715, pad * 0.6, w * 0.285, footTop - pad * 0.6 - 4 * u, "center", 0.8);
      else cutout(ctx, photo.image, side === "f1" ? w * 0.01 : w * 0.49, top - 14 * u, w * 0.5, heroH - infoH * 0.5 + 14 * u, "center", 0.66);
    } else {
      // A headshot sits above the names rather than behind them.
      const size = wide ? Math.min(w * 0.23, h * 0.42) : Math.max(90 * u, Math.min(w * 0.34, blockBottom - blockH - top - 20 * u));
      const hx = wide ? (side === "f1" ? w * 0.143 : w * 0.857) : side === "f1" ? w * 0.26 : w * 0.74;
      const hy = wide ? h * 0.42 : top + size / 2 + 4 * u;
      roundel(ctx, photo.image, hx, hy, size, corner.outcome === "win" ? p.win : p.accent);
    }
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = p.shadow;
  ctx.shadowBlur = 28 * u;
  corners.forEach((corner, index) => {
    const side = index === 0 ? "f1" : "f2";
    const base = baselines[index];
    const mid = base - size * 0.36;
    const total = Math.min(nameWidth, lineWidth(index, size));
    let x = cx - total / 2;
    if (corner.rank) x += rankBox(ctx, corner.rank, x, mid, size * 0.56, p) + size * 0.14;
    const dim = corner.outcome === "loss" || (g.pick && g.pick.side !== side);
    ctx.fillStyle = dim ? p.faint : p.ink;
    ctx.textAlign = "left";
    const room = Math.max(40 * u, nameWidth - extras(index, size));
    ctx.font = cond(800, size);
    const textW = Math.min(room, ctx.measureText(names[index]).width);
    fit(ctx, names[index], x, base, room, (s) => cond(800, s), size, size * 0.6);
    x += textW + size * 0.14;
    const drawn = flag(ctx, corner.flag, x, mid, size * 0.46, "left");
    if (drawn) x += drawn + size * 0.14;
    if (g.pick?.side === side) mark(ctx, x + size * 0.2, mid, size * 0.2, stateColor(p, g.pick.state), g.pick.state === "lost" ? "cross" : "check", stateInk(p, g.pick.state));
  });
  // VS between them, with a rule either side.
  const vsY = baselines[0] + (baselines[1] - size * 0.86 - baselines[0]) / 2 + vsSize * 0.36;
  ctx.shadowBlur = 0;
  ctx.fillStyle = p.accent;
  ctx.textAlign = "center";
  ctx.font = cond(800, vsSize, true);
  ctx.fillText("VS", cx, vsY);
  const vsW = ctx.measureText("VS").width;
  ctx.fillRect(cx - vsW / 2 - 14 * u - 70 * u, vsY - vsSize * 0.36, 70 * u, Math.max(2, 2.5 * u));
  ctx.fillRect(cx + vsW / 2 + 14 * u, vsY - vsSize * 0.36, 70 * u, Math.max(2, 2.5 * u));
  ctx.restore();

  // Records, prices and form under each corner.
  if (infoH) {
    const infoTop = heroBottom - infoH + 10 * u;
    for (const [index, corner] of corners.entries()) {
      const side = index === 0 ? "f1" : "f2";
      const x = wide ? colX0 + colW * (index === 0 ? 0.25 : 0.75) : w * (index === 0 ? 0.26 : 0.74);
      const half = wide ? colW * 0.48 : w * 0.44;
      let y = infoTop;
      ctx.textAlign = "center";
      if (corner.nickname) {
        ctx.fillStyle = p.muted;
        fit(ctx, `“${corner.nickname}”`, x, y + 26 * u, half, (s) => cond(600, s, true), 28 * u, 18 * u);
        y += 40 * u;
      }
      if (corner.lines.length) {
        ctx.fillStyle = p.muted;
        fit(ctx, upper(corner.lines.join(" · ")), x, y + 26 * u, half, (s) => cond(600, s), 29 * u, 18 * u);
        y += 40 * u;
      }
      const items: { width: number; draw: (left: number) => void }[] = [];
      if (corner.result) {
        ctx.font = cond(800, 24 * u);
        const text = upper(corner.result);
        const width = Math.min(half, ctx.measureText(text).width + 30 * u);
        items.push({ width, draw: (left) => pill(ctx, text, left + width / 2, y + 2 * u, 34 * u, corner.outcome === "win" ? p.win : corner.outcome === "draw" ? p.draw : p.panelStrong, corner.outcome === "win" || corner.outcome === "draw" ? "#ffffff" : p.muted, cond(800, 24 * u), half) });
      } else if (corner.odds) {
        ctx.font = cond(800, 30 * u);
        const width = ctx.measureText(corner.odds).width + 30 * u;
        items.push({ width, draw: (left) => pill(ctx, corner.odds!, left + width / 2, y + 1 * u, 36 * u, p.panelStrong, side === "f1" ? p.f1 : p.f2, cond(800, 30 * u)) });
      }
      if (corner.form?.length) {
        const width = corner.form.length * 26 * u + (corner.form.length - 1) * 26 * u * 0.28;
        items.push({ width, draw: (left) => formSquares(ctx, corner.form!, left, y + 6 * u, 26 * u, p, "left") });
      }
      const gap = 14 * u;
      let left = x - (items.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, items.length - 1)) / 2;
      for (const item of items) { item.draw(left); left += item.width + gap; }
      if (index === 1 && g.marketHeading && corners.some((c) => c.odds)) {
        ctx.fillStyle = p.faint;
        ctx.textAlign = "center";
        label(ctx, upper(g.marketHeading), cx, y + 26 * u, cond(700, 17 * u), 2 * u, w * 0.12);
      }
    }
  }

  // The pick and the share bars.
  let y = heroBottom + 4 * u;
  if (g.pick) {
    const boxH = 66 * u;
    const color = stateColor(p, g.pick.state);
    roundRect(ctx, colX0, y, colW, boxH, 10 * u);
    ctx.fillStyle = p.panelStrong;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(colX0, y, 8 * u, boxH);
    ctx.font = cond(800, 22 * u);
    spacing(ctx, 2 * u);
    const heading = upper(g.pick.heading);
    const chipW = ctx.measureText(heading).width + 28 * u;
    spacing(ctx, 0);
    roundRect(ctx, colX0 + 22 * u, y + boxH / 2 - 17 * u, chipW, 34 * u, 6 * u);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = stateInk(p, g.pick.state);
    ctx.textAlign = "center";
    label(ctx, heading, colX0 + 22 * u + chipW / 2, y + boxH / 2 + 8 * u, cond(800, 22 * u), 2 * u);
    const verdict = g.pick.state === "won" ? "RIGHT" : g.pick.state === "lost" ? "WRONG" : g.pick.state === "void" ? "VOID" : "";
    ctx.font = cond(800, 28 * u);
    const verdictW = verdict ? ctx.measureText(verdict).width + 50 * u : 0;
    if (verdict) {
      mark(ctx, colX1 - verdictW + 14 * u, y + boxH / 2, 14 * u, color, stateMark(g.pick.state));
      ctx.fillStyle = color;
      ctx.textAlign = "right";
      ctx.fillText(verdict, colX1 - 18 * u, y + boxH / 2 + 10 * u);
    }
    ctx.fillStyle = p.ink;
    ctx.textAlign = "left";
    const pickedName = upper(corners[g.pick.side === "f1" ? 0 : 1].name);
    const text = g.pick.detail ? `${pickedName} · ${upper(g.pick.detail)}` : pickedName;
    fit(ctx, text, colX0 + 22 * u + chipW + 18 * u, y + boxH / 2 + 12 * u, colW - chipW - 60 * u - verdictW, (s) => cond(800, s), 36 * u, 20 * u);
    y += boxH + 14 * u;
  }
  for (const split of g.splits) {
    splitBar(ctx, split, colX0, y, colW, 78 * u, p, u);
    y += 88 * u;
  }

  // The comparison table.
  const tableBottom = footTop - 10 * u - judgeNeed * tableScale;
  const rowNeed = rows.reduce((sum, entry) => sum + ("heading" in entry ? 40 : 46) * u, 0);
  const scale = rows.length ? Math.min(1, tableScale, (tableBottom - y) / Math.max(1, rowNeed)) : 1;
  for (const entry of rows) {
    if ("heading" in entry) {
      const rowH = 40 * u * scale;
      ctx.textAlign = "center";
      ctx.fillStyle = p.accent;
      label(ctx, upper(entry.heading), cx, y + rowH * 0.72, cond(800, 21 * u * Math.max(scale, 0.75), true), 3 * u, colW);
      y += rowH;
      continue;
    }
    const rowH = 46 * u * scale;
    const row = entry.row;
    ctx.fillStyle = p.line;
    ctx.fillRect(colX0, y, colW, Math.max(1, 1.5 * u));
    const baseline = y + rowH * 0.7;
    const valueSize = 33 * u * Math.max(scale, 0.66);
    if (row.shared) {
      ctx.textAlign = "left";
      ctx.fillStyle = p.muted;
      fit(ctx, upper(row.label), colX0 + 8 * u, baseline, colW * 0.76, (s) => cond(600, s), 24 * u * Math.max(scale, 0.7), 14 * u);
      ctx.textAlign = "right";
      ctx.fillStyle = p.ink;
      fit(ctx, row.shared, colX1 - 8 * u, baseline, colW * 0.2, (s) => cond(800, s), valueSize, 16 * u);
      y += rowH;
      continue;
    }
    ctx.textAlign = "center";
    ctx.fillStyle = p.muted;
    label(ctx, upper(row.label), cx, baseline - 2 * u, cond(700, 20 * u * Math.max(scale, 0.75)), 1.5 * u, colW * 0.4);
    for (const side of ["f1", "f2"] as const) {
      const edge = row.edge === side;
      const color = side === "f1" ? p.f1 : p.f2;
      ctx.fillStyle = edge ? color : p.ink;
      ctx.textAlign = side === "f1" ? "left" : "right";
      const x = side === "f1" ? colX0 + 8 * u : colX1 - 8 * u;
      const used = fit(ctx, row[side], x, baseline, colW * 0.28, (s) => cond(edge ? 800 : 600, s), valueSize, 16 * u);
      if (edge) {
        ctx.font = cond(800, used);
        const width = Math.min(colW * 0.28, ctx.measureText(row[side]).width);
        const tip = side === "f1" ? x + width + 12 * u : x - width - 12 * u;
        const dir = side === "f1" ? -1 : 1;
        ctx.beginPath();
        ctx.moveTo(tip, baseline - used * 0.34);
        ctx.lineTo(tip - dir * 9 * u, baseline - used * 0.34 - 7 * u);
        ctx.lineTo(tip - dir * 9 * u, baseline - used * 0.34 + 7 * u);
        ctx.closePath();
        ctx.fill();
      }
    }
    y += rowH;
  }

  if (judges.length) {
    const jy = footTop - 10 * u - judgeNeed * tableScale + 26 * u;
    ctx.textAlign = "center";
    ctx.fillStyle = p.accent;
    label(ctx, "JUDGES’ SCORECARDS", cx, jy, cond(800, 21 * u, true), 3 * u);
    const colWidth = colW / judges.length;
    judges.forEach((judge, index) => {
      const jx = colX0 + colWidth * index + colWidth / 2;
      ctx.fillStyle = p.muted;
      ctx.textAlign = "center";
      fit(ctx, upper(judge.name), jx, jy + 36 * u, colWidth - 12 * u, (s) => cond(600, s), 22 * u, 14 * u);
      ctx.font = cond(800, 50 * u);
      ctx.textAlign = "right";
      ctx.fillStyle = judge.f1 > judge.f2 ? p.f1 : p.faint;
      ctx.fillText(String(judge.f1), jx - 12 * u, jy + 90 * u);
      ctx.textAlign = "center";
      ctx.fillStyle = p.faint;
      ctx.fillText("–", jx, jy + 90 * u);
      ctx.textAlign = "left";
      ctx.fillStyle = judge.f2 > judge.f1 ? p.f2 : p.faint;
      ctx.fillText(String(judge.f2), jx + 12 * u, jy + 90 * u);
    });
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

// ---------------------------------------------------------------------------
// One fighter

function renderFighter(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: FighterGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 48 * u;
  backdrop(ctx, w, h, p, false);
  const footTop = h - pad - 54 * u;
  const bottom = footTop - 14 * u;
  const hasPhoto = Boolean(g.photo);
  const photoW = hasPhoto ? (format === "landscape" ? w * 0.36 : w * 0.42) : 0;
  if (g.photo) {
    ctx.save();
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 6 * u;
    octagon(ctx, pad + photoW / 2, (pad + bottom) / 2, Math.min(photoW * 0.62, (bottom - pad) * 0.46));
    ctx.stroke();
    ctx.restore();
    if (g.photo.kind === "full") {
      // As tall as the column allows, cropped at its edge rather than shrunk to its width.
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, pad + photoW + 14 * u, h);
      ctx.clip();
      cutout(ctx, g.photo.image, pad - photoW * 0.25, pad + 10 * u, photoW * 1.5, bottom - pad - 10 * u, "center", 0.74);
      ctx.restore();
    }
    else roundel(ctx, g.photo.image, pad + (photoW - 20 * u) / 2, pad + 40 * u + (photoW - 20 * u) / 2, photoW - 20 * u, p.accent);
  }
  const textX = hasPhoto ? pad + photoW + 24 * u : pad;
  const textW = w - textX - pad;
  let y = pad + 24 * u;
  ctx.textAlign = "left";
  ctx.fillStyle = p.accent;
  label(ctx, upper(g.eyebrow), textX, y, cond(800, 24 * u), 3 * u, textW);
  y += 12 * u;
  // The name, as big as its length allows, over two lines when long.
  const words = upper(g.name).split(" ");
  const oneLine = sizeFor(ctx, words.join(" "), textW - (g.rank ? 80 * u : 0), (s) => cond(800, s), 132 * u, 60 * u);
  // Two lines when long, and a Jr. or III stays with the surname.
  const tail = words.length > 2 && /^(?:JR|SR)\.?$|^(?:II|III|IV)$/.test(words.at(-1)!) ? 2 : 1;
  const lines = oneLine < 96 * u && words.length > tail ? [words.slice(0, -tail).join(" "), words.slice(-tail).join(" ")] : [words.join(" ")];
  const size = lines.length > 1 ? Math.min(...lines.map((line) => sizeFor(ctx, line, textW - (g.rank ? 80 * u : 0), (s) => cond(800, s), 132 * u, 50 * u))) : oneLine;
  for (const [index, line] of lines.entries()) {
    y += size * 0.86;
    let x = textX;
    if (g.rank && index === lines.length - 1) x += rankBox(ctx, g.rank, x, y - size * 0.36, size * 0.52, p) + size * 0.14;
    ctx.fillStyle = p.ink;
    ctx.textAlign = "left";
    fit(ctx, line, x, y, textX + textW - x, (s) => cond(800, s), size, size * 0.6);
  }
  if (g.nickname || g.flag) {
    y += 42 * u;
    let x = textX;
    const drawn = flag(ctx, g.flag, x, y - 11 * u, 34 * u, "left");
    if (drawn) x += drawn + 12 * u;
    if (g.nickname) {
      ctx.fillStyle = p.muted;
      ctx.textAlign = "left";
      fit(ctx, `“${g.nickname}”`, x, y, textX + textW - x, (s) => cond(600, s, true), 34 * u, 20 * u);
    }
  }
  y += 24 * u;
  let bx = textX;
  for (const badge of g.badges) {
    const belt = badge.startsWith("Champion") || badge.startsWith("Interim");
    ctx.font = cond(800, 25 * u);
    const bw = Math.min(textW, ctx.measureText(upper(badge)).width + 30 * u);
    if (bx + bw > textX + textW) { bx = textX; y += 46 * u; }
    roundRect(ctx, bx, y, bw, 38 * u, 6 * u);
    ctx.fillStyle = belt ? p.gold : p.panelStrong;
    ctx.fill();
    ctx.fillStyle = belt ? "#111111" : p.ink;
    ctx.textAlign = "center";
    ctx.fillText(upper(badge), bx + bw / 2, y + 28 * u, bw - 16 * u);
    bx += bw + 10 * u;
  }
  if (g.badges.length) y += 62 * u;
  if (g.facts.length) {
    const cols = Math.min(g.facts.length, format === "landscape" ? 4 : 2);
    const colW = textW / cols;
    g.facts.forEach((fact, index) => {
      const fx = textX + (index % cols) * colW;
      const fy = y + Math.floor(index / cols) * 74 * u;
      ctx.fillStyle = p.faint;
      ctx.textAlign = "left";
      label(ctx, upper(fact.label), fx, fy + 18 * u, cond(700, 19 * u), 2 * u);
      ctx.fillStyle = p.ink;
      fit(ctx, upper(fact.value), fx, fy + 58 * u, colW - 12 * u, (s) => cond(800, s), 42 * u, 22 * u);
    });
    y += Math.ceil(g.facts.length / cols) * 74 * u + 8 * u;
  }
  if (g.form?.length) {
    ctx.fillStyle = p.faint;
    ctx.textAlign = "left";
    label(ctx, "LAST FIVE", textX, y + 18 * u, cond(700, 19 * u), 2 * u);
    formSquares(ctx, g.form.map((entry) => entry.outcome), textX, y + 30 * u, 36 * u, p, "left");
    ctx.fillStyle = p.muted;
    ctx.textAlign = "left";
    fit(ctx, upper(g.form.map((entry) => entry.label).join(" · ")), textX, y + 96 * u, textW, (s) => cond(600, s), 22 * u, 14 * u);
    y += 120 * u;
  }
  if (g.stats.length) {
    const rowH = Math.min(66 * u, (bottom - y) / g.stats.length);
    const scale = Math.min(1, rowH / (66 * u));
    for (const stat of g.stats) {
      ctx.fillStyle = p.line;
      ctx.fillRect(textX, y, textW, Math.max(1, 1.5 * u));
      let lx = textX;
      if (stat.rank) {
        const top1 = stat.rank === "#1" || stat.rank === "#T1";
        ctx.font = cond(800, 26 * u * Math.max(scale, 0.7));
        const bw = Math.max(64 * u * scale, ctx.measureText(stat.rank).width + 20 * u);
        roundRect(ctx, textX, y + rowH * 0.18, bw, rowH * 0.64, 6 * u);
        ctx.fillStyle = top1 ? p.gold : p.panelStrong;
        ctx.fill();
        ctx.fillStyle = top1 ? "#111111" : p.ink;
        ctx.textAlign = "center";
        ctx.fillText(stat.rank, textX + bw / 2, y + rowH * 0.62);
        lx += bw + 14 * u;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = p.ink;
      fit(ctx, upper(stat.label), lx, y + rowH * (stat.detail ? 0.5 : 0.64), textW * 0.66 - (lx - textX), (s) => cond(700, s), 28 * u * Math.max(scale, 0.7), 12 * u);
      if (stat.detail) {
        ctx.fillStyle = p.faint;
        fit(ctx, stat.detail, lx, y + rowH * 0.84, textW * 0.64 - (lx - textX), (s) => sans(500, s), 15 * u * Math.max(scale, 0.75), 10 * u);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = p.ink;
      fit(ctx, stat.value, textX + textW, y + rowH * 0.68, textW * 0.33, (s) => cond(800, s), 38 * u * Math.max(scale, 0.7), 18 * u);
      y += rowH;
    }
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

// ---------------------------------------------------------------------------
// A card

/** The date line at the foot of a card poster. Returns its top. */
function dateBlock(ctx: Ctx, w: number, u: number, bottom: number, p: Palette, date: CardGraphic["date"]): number {
  const cx = w / 2;
  ctx.textAlign = "center";
  if (date.small) {
    ctx.fillStyle = p.muted;
    fit(ctx, upper(date.small), cx, bottom - 4 * u, w * 0.8, (s) => cond(600, s), 24 * u, 15 * u);
  }
  const base = bottom - (date.small ? 34 * u : 4 * u);
  ctx.fillStyle = p.ink;
  ctx.font = cond(800, 66 * u);
  ctx.fillText(upper(date.big), cx, base);
  return base - 60 * u;
}

/** A rule with a label in its middle: "PRELIMS". */
function groupRule(ctx: Ctx, text: string, x0: number, x1: number, y: number, u: number, p: Palette) {
  const cx = (x0 + x1) / 2;
  ctx.font = cond(800, 22 * u);
  spacing(ctx, 4 * u);
  const width = ctx.measureText(upper(text)).width;
  ctx.fillStyle = p.accent;
  ctx.textAlign = "center";
  ctx.fillText(upper(text), cx, y + 8 * u);
  spacing(ctx, 0);
  ctx.fillStyle = p.line;
  ctx.fillRect(x0, y, Math.max(0, cx - width / 2 - 18 * u - x0), Math.max(1, 1.5 * u));
  ctx.fillRect(cx + width / 2 + 18 * u, y, Math.max(0, x1 - cx - width / 2 - 18 * u), Math.max(1, 1.5 * u));
}

/** Two pieces of text on one line, the second in ink; anchored at `x`. */
function pair(ctx: Ctx, first: string, second: string, x: number, y: number, align: "left" | "right", size: number, p: Palette, firstColor = p.faint) {
  const joiner = first && second ? "  " : "";
  ctx.font = cond(600, size);
  const firstW = ctx.measureText(first + joiner).width;
  ctx.font = cond(800, size);
  const secondW = ctx.measureText(second).width;
  const left = align === "left" ? x : x - firstW - secondW;
  ctx.textAlign = "left";
  ctx.font = cond(600, size);
  ctx.fillStyle = firstColor;
  ctx.fillText(first + joiner, left, y);
  ctx.font = cond(800, size);
  ctx.fillStyle = p.ink;
  ctx.fillText(second, left + firstW, y);
}

function renderCardList(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 46 * u;
  backdrop(ctx, w, h, p, false);
  const footTop = h - pad - 54 * u;
  const headBottom = masthead(ctx, u, pad, p, pad, w - pad, g.eyebrow, g.title, g.subtitle, format === "landscape" ? 92 * u : 116 * u);
  const dateTop = dateBlock(ctx, w, u, footTop - 16 * u, p, g.date);
  const top = headBottom + 22 * u;
  const bottom = dateTop - 8 * u;
  const splitCount = Math.max(0, ...g.rows.map((row) => row.splits.length));
  const hasSub = g.rows.some((row) => row.f1.sub || row.f2.sub || row.f1.odds || row.f2.odds || row.pick || row.result);
  const weightOf = (index: number) => (index === 0 && g.rows.length > 2 ? 1.35 : 1);
  const groups = g.rows.filter((row, index) => row.group && row.group !== g.rows[index - 1]?.group).length;
  const total = g.rows.reduce((sum, _row, index) => sum + weightOf(index), 0) + groups * 0.45;
  // A row's height in units of its name size.
  const perSize = 0.42 * 1.45 + 1 + (hasSub ? 0.62 : 0) + splitCount * 0.95 + 0.34;
  const unit = Math.min((bottom - top) / Math.max(1, total), 76 * u * perSize);
  let y = top + Math.max(0, (bottom - top - unit * total) / 2);
  const flags = g.rows.some((row) => flagWidth(ctx, row.f1.flag, 30 * u) || flagWidth(ctx, row.f2.flag, 30 * u));
  const mid = w / 2;
  g.rows.forEach((row, index) => {
    if (row.group && row.group !== g.rows[index - 1]?.group) {
      groupRule(ctx, row.group, pad, w - pad, y + unit * 0.24, u, p);
      y += unit * 0.45;
    }
    const rowH = unit * weightOf(index);
    const s = rowH / perSize;
    const metaSize = Math.max(13 * u, s * 0.42);
    if (index > 0 && !(row.group && row.group !== g.rows[index - 1]?.group)) {
      ctx.fillStyle = p.line;
      ctx.fillRect(pad + w * 0.12, y, w - pad * 2 - w * 0.24, Math.max(1, 1.2 * u));
    }
    let lineY = y + s * 0.17 + metaSize;
    ctx.textAlign = "center";
    ctx.fillStyle = row.title ? p.gold : p.accent;
    label(ctx, upper(row.meta), mid, lineY, cond(800, metaSize, true), metaSize * 0.3, w * 0.7);
    lineY += s * 0.12 + s * 0.84;
    const flagSize = Math.min(s * 0.62, 46 * u);
    const flagRoom = flags ? flagSize * 1.5 + 12 * u : 0;
    const gap = s * 0.62;
    const rankSize = s * 0.64;
    const nameMid = lineY - s * 0.34;
    // One size for both names, so neither corner looks favoured.
    const room = (side: "f1" | "f2") => mid - gap - pad - flagRoom - (row[side].rank ? rankWidth(ctx, row[side].rank!, rankSize) + s * 0.18 : 0);
    const nameSize = Math.min(
      sizeFor(ctx, upper(row.f1.name), room("f1"), (v) => cond(800, v), s, s * 0.55),
      sizeFor(ctx, upper(row.f2.name), room("f2"), (v) => cond(800, v), s, s * 0.55),
    );
    for (const side of ["f1", "f2"] as const) {
      const c = row[side];
      const left = side === "f1";
      const picked = row.pick?.side === side;
      const dim = (row.winner && row.winner !== side) || (row.pick && !picked);
      const space = room(side);
      ctx.font = cond(800, nameSize);
      const textW = Math.min(space, ctx.measureText(upper(c.name)).width);
      const anchor = left ? mid - gap : mid + gap;
      ctx.fillStyle = picked ? stateColor(p, row.pick!.state) : dim ? p.faint : p.ink;
      ctx.textAlign = left ? "right" : "left";
      fit(ctx, upper(c.name), anchor, lineY, space, (v) => cond(800, v), nameSize, nameSize * 0.8);
      if (c.rank) rankBox(ctx, c.rank, left ? anchor - textW - s * 0.18 - rankWidth(ctx, c.rank, rankSize) : anchor + textW + s * 0.18, nameMid, rankSize, p);
      if (flags) flag(ctx, c.flag, left ? pad : w - pad, nameMid, flagSize, left ? "left" : "right");
      // Under the name: the pick, or the record and price.
      if (hasSub) {
        const subY = lineY + s * 0.52;
        const subSize = Math.max(12 * u, s * 0.4);
        if (picked) {
          const color = stateColor(p, row.pick!.state);
          const text = ["MY PICK", row.pick!.detail ? upper(row.pick!.detail) : null].filter(Boolean).join(" · ");
          ctx.font = cond(800, subSize);
          const tw = ctx.measureText(text).width;
          const r = subSize * 0.42;
          const markX = left ? anchor - tw - r - 8 * u : anchor + r;
          mark(ctx, markX, subY - subSize * 0.34, r, color, row.pick!.state === "lost" ? "cross" : "check", stateInk(p, row.pick!.state));
          ctx.fillStyle = color;
          ctx.textAlign = left ? "right" : "left";
          ctx.fillText(text, left ? anchor : anchor + r * 2 + 8 * u, subY);
        } else {
          pair(ctx, c.sub ?? "", c.odds ?? "", anchor, subY, left ? "right" : "left", subSize, p);
        }
      }
    }
    ctx.textAlign = "center";
    ctx.fillStyle = p.accent;
    ctx.font = cond(800, s * 0.46, true);
    ctx.fillText("vs", mid, lineY - s * 0.06);
    if (row.result) {
      ctx.fillStyle = p.win;
      fit(ctx, upper(row.result), mid, lineY + s * 0.52, gap * 2.4, (v) => cond(800, v), Math.max(12 * u, s * 0.36), 10 * u);
    }
    let barY = lineY + (hasSub ? s * 0.72 : s * 0.2);
    for (const split of row.splits) {
      splitBar(ctx, split, pad + flagRoom, barY, w - (pad + flagRoom) * 2, s * 0.9, p, u);
      barY += s * 0.95;
    }
    y += rowH;
  });
  footer(ctx, w, h, u, pad, p, g.footer);
}

function renderCardFaces(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 46 * u;
  backdrop(ctx, w, h, p, false);
  const footTop = h - pad - 54 * u;
  const headBottom = masthead(ctx, u, pad, p, pad, w - pad, g.eyebrow, g.title, g.subtitle, format === "landscape" ? 80 * u : 100 * u);
  const dateTop = dateBlock(ctx, w, u, footTop - 16 * u, p, g.date);
  const top = headBottom + 24 * u;
  const bottom = dateTop - 10 * u;
  const n = g.rows.length;
  const cols = format === "landscape" ? 4 : n <= 4 ? 2 : 3;
  const big = n >= 4 ? 2 : Math.min(n, 2);
  const rest = n - big;
  const restRows = Math.ceil(rest / cols);
  const gapX = 18 * u;
  const gapY = 22 * u;
  const width = w - pad * 2;
  const bigW = big ? (width - gapX * (big - 1)) / big : 0;
  const smallW = (width - gapX * (cols - 1)) / cols;
  // Pictures are about as tall as each is wide; the captions are fixed. The
  // pictures give or take height to fill the space between the headline and the date.
  const bigCap = 84 * u;
  const smallCap = 72 * u;
  const rowsH = (big ? 1 : 0) + restRows;
  const fixed = (big ? bigCap : 0) + restRows * smallCap + gapY * Math.max(0, rowsH - 1);
  const natural = (big ? bigW / 2 : 0) + restRows * (smallW / 2) * 1.05;
  const k = Math.max(0.5, Math.min(1.6, (bottom - top - fixed) / Math.max(1, natural)));
  const bigH = big ? (bigW / 2) * k + bigCap : 0;
  const smallH = (smallW / 2) * 1.05 * k + smallCap;
  const used = (big ? bigH + gapY : 0) + restRows * smallH + Math.max(0, restRows - 1) * gapY;
  let y = top + Math.max(0, (bottom - top - used) / 2);
  const tile = (row: CardRow, x: number, ty: number, tw: number, th: number, main: boolean) => {
    const captionH = main ? bigCap : smallCap;
    const photoH = th - captionH;
    const inner = 6 * u;
    const each = (tw - inner) / 2;
    for (const side of ["f1", "f2"] as const) {
      const c = row[side];
      const px = side === "f1" ? x : x + each + inner;
      const picked = row.pick?.side === side;
      const dim = (row.winner && row.winner !== side) || (row.pick && !picked);
      ctx.save();
      roundRect(ctx, px, ty, each, photoH, 10 * u);
      ctx.clip();
      ctx.fillStyle = p.bg2;
      ctx.fillRect(px, ty, each, photoH);
      const wash = ctx.createLinearGradient(0, ty, 0, ty + photoH);
      wash.addColorStop(0, p.panel);
      wash.addColorStop(1, p.panelStrong);
      ctx.fillStyle = wash;
      ctx.fillRect(px, ty, each, photoH);
      const tint = ctx.createRadialGradient(px + each / 2, ty + photoH, 0, px + each / 2, ty + photoH, photoH);
      tint.addColorStop(0, p.glowA);
      tint.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = tint;
      ctx.fillRect(px, ty, each, photoH);
      if (c.photo) coverTop(ctx, c.photo.image, px, ty, each, photoH);
      else {
        ctx.fillStyle = p.faint;
        ctx.textAlign = "center";
        ctx.font = cond(800, Math.min(each, photoH) * 0.42);
        ctx.fillText(upper(c.surname.slice(0, 1)), px + each / 2, ty + photoH * 0.64);
      }
      if (dim) {
        ctx.fillStyle = p.dark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)";
        ctx.fillRect(px, ty, each, photoH);
      }
      // A share or a price across the foot of the picture.
      const figure = row.splits[0] ? `${row.splits[0][side]}%` : c.odds ?? null;
      if (figure) {
        const shade = ctx.createLinearGradient(0, ty + photoH * 0.6, 0, ty + photoH);
        shade.addColorStop(0, "rgba(0,0,0,0)");
        shade.addColorStop(1, "rgba(0,0,0,0.78)");
        ctx.fillStyle = shade;
        ctx.fillRect(px, ty + photoH * 0.6, each, photoH * 0.4);
        ctx.fillStyle = row.splits[0] ? (side === "f1" ? p.f1 : p.f2) : "#ffffff";
        ctx.textAlign = "center";
        ctx.font = cond(800, Math.min(each * 0.3, photoH * 0.2));
        ctx.fillText(figure, px + each / 2, ty + photoH - photoH * 0.06);
      }
      ctx.restore();
      if (picked || (row.winner === side && !row.pick)) {
        const color = picked ? stateColor(p, row.pick!.state) : p.win;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(3, 5 * u);
        roundRect(ctx, px + 2.5 * u, ty + 2.5 * u, each - 5 * u, photoH - 5 * u, 9 * u);
        ctx.stroke();
        const r = Math.min(22 * u, each * 0.12);
        mark(ctx, px + each - r - 8 * u, ty + r + 8 * u, r, color, picked && row.pick!.state === "lost" ? "cross" : "check", picked ? stateInk(p, row.pick!.state) : "#ffffff");
      }
      if (c.rank) rankBox(ctx, c.rank, px + 8 * u, ty + 8 * u + Math.min(30 * u, each * 0.16) / 2, Math.min(30 * u, each * 0.16), p);
    }
    const nameSize = Math.min(captionH * 0.5, main ? 56 * u : 40 * u);
    const cx = x + tw / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = p.ink;
    const vsText = "  vs  ";
    const n1 = upper(row.f1.surname);
    const n2 = upper(row.f2.surname);
    const size = sizeFor(ctx, `${n1}${vsText}${n2}`, tw, (v) => cond(800, v), nameSize, nameSize * 0.5);
    ctx.font = cond(800, size);
    const w1 = ctx.measureText(n1).width;
    const w2 = ctx.measureText(n2).width;
    ctx.font = cond(800, size * 0.7, true);
    const wv = ctx.measureText(vsText).width;
    let left = cx - (w1 + wv + w2) / 2;
    const base = ty + photoH + captionH * 0.5;
    ctx.textAlign = "left";
    const nameColor = (side: "f1" | "f2") => row.pick ? (row.pick.side === side ? stateColor(p, row.pick.state) : p.faint) : row.winner && row.winner !== side ? p.faint : p.ink;
    ctx.font = cond(800, size);
    ctx.fillStyle = nameColor("f1");
    ctx.fillText(n1, left, base);
    left += w1;
    ctx.font = cond(800, size * 0.7, true);
    ctx.fillStyle = p.accent;
    ctx.fillText(vsText, left, base);
    left += wv;
    ctx.font = cond(800, size);
    ctx.fillStyle = nameColor("f2");
    ctx.fillText(n2, left, base);
    ctx.textAlign = "center";
    ctx.fillStyle = row.title ? p.gold : p.accent;
    const meta = row.result ? `${row.meta} · ${row.result}` : row.pick?.detail ? `${row.meta} · pick: ${row.pick.detail}` : row.meta;
    label(ctx, upper(meta), cx, base + captionH * 0.36, cond(800, Math.max(12 * u, size * 0.5), true), 1.5 * u, tw);
  };
  let index = 0;
  if (big) {
    for (let k = 0; k < big; k++) tile(g.rows[index++], pad + k * (bigW + gapX), y, bigW, bigH, true);
    y += bigH + gapY;
  }
  for (let r = 0; r < restRows; r++) {
    const count = Math.min(cols, n - index);
    const rowW = count * smallW + (count - 1) * gapX;
    const x0 = pad + (width - rowW) / 2;
    for (let k = 0; k < count; k++) tile(g.rows[index++], x0 + k * (smallW + gapX), y, smallW, smallH, false);
    y += smallH + gapY;
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

// ---------------------------------------------------------------------------
// A bet slip

function renderParlay(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: ParlayGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 46 * u;
  backdrop(ctx, w, h, p, false);
  const footTop = h - pad - 54 * u;
  const wide = format === "landscape";
  const x0 = wide ? w * 0.16 : pad;
  const x1 = wide ? w * 0.84 : w - pad;
  const cx = (x0 + x1) / 2;
  const headBottom = masthead(ctx, u, pad, p, x0, x1, g.eyebrow, g.title, "", wide ? 84 * u : 100 * u);
  // The combined price, as large as the space allows.
  let y = headBottom + 16 * u;
  const priceSize = Math.min(wide ? 150 * u : 190 * u, (footTop - y) * 0.26);
  ctx.textAlign = "center";
  ctx.fillStyle = p.accent;
  ctx.save();
  ctx.shadowColor = p.shadow;
  ctx.shadowBlur = 30 * u;
  fit(ctx, g.price, cx, y + priceSize * 0.8, x1 - x0, (s) => cond(800, s, true), priceSize, priceSize * 0.6);
  ctx.restore();
  y += priceSize * 0.8 + 30 * u;
  ctx.fillStyle = p.muted;
  label(ctx, g.legs.length > 1 ? "COMBINED ODDS" : "ODDS", cx, y, cond(700, 20 * u), 3 * u);
  y += 24 * u;

  // The ticket: legs, a perforation, then the stake and what it pays.
  const ticketTop = y;
  const ticketBottom = footTop - 46 * u;
  const summaryH = 104 * u;
  const legsH = ticketBottom - ticketTop - summaryH - 30 * u;
  const legH = Math.min(format === "portrait" ? 118 * u : 96 * u, legsH / Math.max(1, g.legs.length));
  const ticketH = legH * g.legs.length + summaryH + 30 * u;
  const tTop = ticketTop + Math.max(0, (ticketBottom - ticketTop - ticketH) / 2);
  const notchY = tTop + legH * g.legs.length + 15 * u;
  const notchR = 16 * u;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x0, tTop, x1 - x0, ticketH, 18 * u);
  ctx.fillStyle = p.panelStrong;
  ctx.fill();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(x0, notchY, notchR, 0, Math.PI * 2);
  ctx.arc(x1, notchY, notchR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = Math.max(1.5, 2 * u);
  ctx.setLineDash([10 * u, 8 * u]);
  ctx.beginPath();
  ctx.moveTo(x0 + notchR + 10 * u, notchY);
  ctx.lineTo(x1 - notchR - 10 * u, notchY);
  ctx.stroke();
  ctx.setLineDash([]);
  const scale = Math.min(1, legH / (96 * u));
  g.legs.forEach((leg, index) => {
    const ly = tTop + index * legH + 15 * u;
    const r = 15 * u * Math.max(scale, 0.7);
    mark(ctx, x0 + 30 * u + r, ly + legH * 0.4, r, leg.state === "pending" ? p.panelStrong : stateColor(p, leg.state), stateMark(leg.state), leg.state === "pending" ? p.muted : "#ffffff");
    const tx = x0 + 30 * u + r * 2 + 18 * u;
    ctx.textAlign = "right";
    ctx.fillStyle = p.ink;
    ctx.font = cond(800, 40 * u * Math.max(scale, 0.6));
    ctx.fillText(leg.price, x1 - 28 * u, ly + legH * 0.5);
    const priceW = ctx.measureText(leg.price).width + 44 * u;
    ctx.textAlign = "left";
    ctx.fillStyle = leg.state === "lost" || leg.state === "void" ? p.faint : p.ink;
    fit(ctx, upper(leg.selection), tx, ly + legH * 0.44, x1 - tx - priceW, (s) => cond(800, s), 36 * u * Math.max(scale, 0.6), 16 * u);
    ctx.fillStyle = p.faint;
    fit(ctx, `${leg.bout} · ${leg.event}`, tx, ly + legH * 0.76, x1 - tx - priceW, (s) => sans(500, s), 17 * u * Math.max(scale, 0.75), 11 * u);
    if (index < g.legs.length - 1) {
      ctx.fillStyle = p.line;
      ctx.fillRect(tx, tTop + (index + 1) * legH + 15 * u - 1, x1 - 28 * u - tx, Math.max(1, 1.2 * u));
    }
  });
  const sy = notchY + 15 * u;
  const third = (x1 - x0 - 56 * u) / 3;
  const cells: [string, string, string][] = [["STAKE", g.stake, p.ink], ["TO PAY", g.payout, p.ink], [g.state === "pending" ? "STATUS" : "RESULT", g.state === "pending" ? "OPEN" : g.net ?? upper(g.state), g.state === "won" ? p.win : g.state === "lost" ? p.loss : p.accent]];
  cells.forEach(([name, value, color], index) => {
    const x = x0 + 28 * u + third * index + third / 2;
    ctx.textAlign = "center";
    ctx.fillStyle = p.faint;
    label(ctx, name, x, sy + 30 * u, cond(700, 19 * u), 2.5 * u);
    ctx.fillStyle = color;
    fit(ctx, value, x, sy + 80 * u, third - 12 * u, (s) => cond(800, s), 48 * u, 22 * u);
  });
  // A stamp across a settled slip.
  if (g.state !== "pending") {
    const text = upper(g.state === "won" ? "Winner" : g.state === "lost" ? "Lost" : "Void");
    ctx.save();
    // On the ticket's top edge, clear of the first leg's price.
    ctx.translate(x1 - (x1 - x0) * 0.2, tTop - 8 * u);
    ctx.rotate(-0.12);
    ctx.font = cond(800, 52 * u);
    spacing(ctx, 6 * u);
    const sw = ctx.measureText(text).width + 40 * u;
    ctx.strokeStyle = stateColor(p, g.state);
    ctx.lineWidth = 5 * u;
    ctx.globalAlpha = 0.9;
    roundRect(ctx, -sw / 2, -38 * u, sw, 72 * u, 10 * u);
    ctx.stroke();
    ctx.fillStyle = stateColor(p, g.state);
    ctx.textAlign = "center";
    ctx.fillText(text, 0, 18 * u);
    spacing(ctx, 0);
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = p.faint;
  fit(ctx, g.placed, cx, tTop + ticketH + 30 * u, x1 - x0, (s) => sans(500, s), 16 * u, 11 * u);
  footer(ctx, w, h, u, pad, p, g.footer);
}

export function renderGraphic(canvas: HTMLCanvasElement, graphic: Graphic, format: Format, theme: Theme) {
  const { width, height } = SIZES[format];
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, width, height);
  const palette = PALETTES[theme] ?? PALETTES.red;
  if (graphic.kind === "versus") renderVersus(ctx, width, height, format, palette, graphic);
  else if (graphic.kind === "fighter") renderFighter(ctx, width, height, format, palette, graphic);
  else if (graphic.kind === "parlay") renderParlay(ctx, width, height, format, palette, graphic);
  else if (graphic.layout === "faces") renderCardFaces(ctx, width, height, format, palette, graphic);
  else renderCardList(ctx, width, height, format, palette, graphic);
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
    if (imageCache.size >= 64) imageCache.delete(imageCache.keys().next().value!);
    imageCache.set(url, pending);
  }
  return pending;
}
