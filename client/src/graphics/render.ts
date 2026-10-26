import {
  backdrop, cage, capHeight, centered, coverTop, cutout, display, fit, flag, flagWidth, footer, footerTop, formSquares, formWidth, heading, label,
  mark, middle, PALETTES, pill, rankBox, rankWidth, roundel, roundRect, sizeFor, splitBar, spacing, text,
  type Ctx, type Footer, type Outcome, type Palette, type Split, type Theme,
} from "./draw";

/**
 * Share graphics, drawn on a canvas from data already on the page, in the
 * style of a fight poster: heavy condensed capitals, rank boxes and flags on a
 * flat backdrop. Five templates — two fighters, one fighter, a card as a bout
 * list or a wall of faces, and a bet slip — each in the three shapes social
 * feeds use. Type is sized against the image's short side so it survives a
 * feed shrinking it, and every image carries the date its numbers are as of
 * and the site's mark.
 */

export type { Footer, Outcome, Split, Theme };
export type Format = "square" | "portrait" | "landscape";

export const SIZES: Record<Format, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Square · 2160 × 2160" },
  portrait: { width: 1080, height: 1350, label: "Portrait · 2160 × 2700" },
  landscape: { width: 1600, height: 900, label: "Landscape · 3200 × 1800" },
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
  let y = top;
  if (eyebrow) {
    const face = text(700, 18 * u);
    y += capHeight(ctx, face);
    ctx.textAlign = "center";
    ctx.fillStyle = p.accent;
    label(ctx, upper(eyebrow), cx, y, face, 3.6 * u, width);
    y += 18 * u;
  }
  const size = sizeFor(ctx, upper(title), width, display, titleSize, titleSize * 0.5);
  y += capHeight(ctx, display(size));
  ctx.textAlign = "center";
  ctx.fillStyle = p.ink;
  fit(ctx, upper(title), cx, y, width, display, size, size);
  if (!subtitle) return y;
  const face = text(500, 19 * u);
  y += 16 * u + capHeight(ctx, face);
  ctx.fillStyle = p.muted;
  fit(ctx, subtitle, cx, y, width, (s) => text(500, s), 19 * u, 13 * u);
  return y;
}

// ---------------------------------------------------------------------------
// Two fighters

function renderVersus(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: VersusGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 48 * u;
  backdrop(ctx, w, h, p);
  const footTop = footerTop(h, u, pad);
  const corners = [g.f1, g.f2];
  const sides = ["f1", "f2"] as const;
  const hasPhotos = corners.some((c) => c.photo);
  // Landscape stands the pictures at the sides and sets everything between them.
  const flank = format === "landscape" && hasPhotos;
  const colX0 = flank ? w * 0.27 : pad;
  const colX1 = flank ? w * 0.73 : w - pad;
  const colW = colX1 - colX0;
  const cx = (colX0 + colX1) / 2;
  const top = masthead(ctx, u, pad, p, colX0, colX1, g.eyebrow, g.label, g.subtitle, 46 * u) + 26 * u;
  const bottom = footTop - 16 * u;
  const space = bottom - top;

  // Each corner's picture, name, record, price and figures share one axis.
  const middleW = Math.max(150 * u, colW * 0.16);
  const halfW = (colW - middleW) / 2;
  const axes = [colX0 + halfW / 2, colX1 - halfW / 2] as const;

  // The names: one size for both, so neither corner looks favoured.
  const names = corners.map((c) => upper(c.surname));
  const capRatio = capHeight(ctx, display(100)) / 100 || 0.72;
  const gapFor = (size: number) => size * 0.16;
  const pieces = (index: number, size: number) => {
    const c = corners[index];
    const cap = size * capRatio;
    const rank = c.rank ? rankWidth(ctx, c.rank, cap) + gapFor(size) : 0;
    const flagged = flagWidth(ctx, c.flag, cap * 1.1);
    const picked = g.pick?.side === sides[index] ? cap * 0.64 + gapFor(size) : 0;
    ctx.font = display(size);
    return { rank, name: ctx.measureText(names[index]).width, flag: flagged ? flagged + gapFor(size) : 0, picked };
  };
  const lineWidth = (index: number, size: number) => { const part = pieces(index, size); return part.rank + part.name + part.flag + part.picked; };
  let size = flank ? 66 * u : hasPhotos ? 78 * u : 100 * u;
  while (size > 34 * u && Math.max(lineWidth(0, size), lineWidth(1, size)) > halfW) size -= u;
  const cap = size * capRatio;
  const hasNick = corners.some((c) => c.nickname);
  const hasLines = corners.some((c) => c.lines.length);
  const hasChips = corners.some((c) => c.odds || c.result || c.form?.length);
  const hero = hasPhotos && !flank;
  const bandNeed = (hero ? 32 * u : 0) + cap + (hasNick ? 36 * u : 0) + (hasLines ? 36 * u : 0) + (hasChips ? 52 * u : 0) + 30 * u;

  // What sits under the names decides how much room the pictures get.
  const HEAD = 42 * u;
  const ROW = 46 * u;
  const rows = g.sections.flatMap((section) => [{ heading: section.title } as const, ...section.rows.map((row) => ({ row }))]);
  const judges = g.judges ?? [];
  const judgeNeed = judges.length ? 132 * u : 0;
  const tableNeed = rows.reduce((sum, entry) => sum + ("heading" in entry ? HEAD : ROW), 0) + judgeNeed;
  const fixed = bandNeed + (g.pick ? 82 * u : 0) + g.splits.length * 86 * u;
  let heroH = 0;
  let scale = 1;
  if (hero) {
    const minHero = space * (format === "square" ? 0.32 : 0.4);
    heroH = space - fixed - tableNeed;
    if (heroH < minHero) {
      scale = tableNeed ? Math.max(0.62, (space - fixed - minHero) / tableNeed) : 1;
      heroH = space - fixed - tableNeed * scale;
      // A long table gives up more of the picture before it shrinks further.
      if (heroH < space * 0.16) {
        heroH = space * 0.16;
        scale = tableNeed ? Math.max(0.5, (space - fixed - heroH) / tableNeed) : 1;
      }
    }
  } else if (tableNeed) {
    scale = Math.min(1.2, Math.max(0.55, (space - fixed) / tableNeed));
  }
  // Without a hero the block sits in the middle of what is left.
  const spare = Math.max(0, space - heroH - fixed - tableNeed * scale);
  let y = top + (heroH ? 0 : spare / 2);

  // Pictures, cut clean where the panel starts, over the cage.
  if (flank) {
    const photoTop = pad * 0.5;
    corners.forEach((corner, index) => {
      const photo = corner.photo;
      if (!photo) return;
      ctx.save();
      if (dimmed(g, index)) setBack(ctx);
      if (photo.kind === "full") cutout(ctx, photo.image, index === 0 ? 0 : w * 0.73, photoTop, w * 0.27, footTop - photoTop, "center", 0.9);
      else roundel(ctx, photo.image, index === 0 ? w * 0.135 : w * 0.865, h * 0.42, Math.min(w * 0.22, h * 0.42), corner.outcome === "win" ? p.win : p.accent);
      ctx.restore();
    });
  } else if (heroH) {
    const heroTop = top - 18 * u;
    const heroBottom = top + heroH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, heroTop, w, heroBottom - heroTop);
    ctx.clip();
    cage(ctx, cx, heroTop + (heroBottom - heroTop) * 0.55, Math.min(colW * 0.3, (heroBottom - heroTop) * 0.52), u, p);
    ctx.restore();
    corners.forEach((corner, index) => {
      const photo = corner.photo;
      if (!photo) return;
      ctx.save();
      if (dimmed(g, index)) setBack(ctx);
      if (photo.kind === "full") cutout(ctx, photo.image, axes[index] - colW / 4, heroTop, colW / 2, heroBottom - heroTop, "center", 0.8);
      else {
        const ring = Math.min(halfW * 0.86, (heroBottom - heroTop) * 0.86);
        roundel(ctx, photo.image, axes[index], (heroTop + heroBottom) / 2, ring, corner.outcome === "win" ? p.win : p.accent);
      }
      ctx.restore();
    });
    ctx.fillStyle = p.raised;
    ctx.fillRect(0, heroBottom, w, h - heroBottom);
    ctx.fillStyle = p.accent;
    ctx.fillRect(0, heroBottom, w, Math.max(2, 4 * u));
    y = heroBottom + 32 * u;
  }

  // The names, each on its corner's axis, VS between them.
  const nameMid = y + cap / 2;
  corners.forEach((corner, index) => {
    const side = sides[index];
    const part = pieces(index, size);
    const room = halfW - part.rank - part.flag - part.picked;
    let x = axes[index] - Math.min(halfW, lineWidth(index, size)) / 2;
    if (corner.rank) x += rankBox(ctx, corner.rank, x, nameMid, cap, p) + gapFor(size);
    ctx.fillStyle = dimmed(g, index) ? p.faint : p.ink;
    ctx.textAlign = "left";
    fit(ctx, names[index], x, y + cap, room, display, size, size * 0.7);
    x += Math.min(room, part.name) + gapFor(size);
    const drawn = flag(ctx, corner.flag, x, nameMid, cap * 1.1, "left");
    if (drawn) x += drawn + gapFor(size);
    if (g.pick?.side === side) mark(ctx, x + cap * 0.32, nameMid, cap * 0.32, stateColor(p, g.pick.state), g.pick.state === "lost" ? "cross" : "check", stateInk(p, g.pick.state));
  });
  ctx.font = display(Math.max(26 * u, size * 0.44));
  ctx.fillStyle = p.accent;
  centered(ctx, "VS", cx, nameMid);
  y += cap;

  // Nickname, record, then the price or result beside the last five.
  if (hasNick) {
    y += 36 * u;
    corners.forEach((corner, index) => {
      if (!corner.nickname) return;
      ctx.fillStyle = p.muted;
      ctx.textAlign = "center";
      fit(ctx, `“${corner.nickname}”`, axes[index], y, halfW, (s) => text(500, s), 21 * u, 14 * u);
    });
  }
  if (hasLines) {
    y += 36 * u;
    corners.forEach((corner, index) => {
      if (!corner.lines.length) return;
      ctx.fillStyle = p.muted;
      ctx.textAlign = "center";
      const line = upper(corner.lines.join(" · "));
      const used = sizeFor(ctx, line, halfW, (s) => text(600, s), 19 * u, 13 * u);
      label(ctx, line, axes[index], y, text(600, used), 1.2 * u, halfW);
    });
  }
  if (hasChips) {
    const mid = y + 34 * u;
    corners.forEach((corner, index) => {
      const items: { width: number; draw: (left: number) => void }[] = [];
      if (corner.result) {
        const face = text(800, 15 * u);
        ctx.font = face;
        spacing(ctx, 1.2 * u);
        const label = upper(corner.result);
        const width = Math.min(halfW, ctx.measureText(label).width + 30 * u);
        spacing(ctx, 0);
        const win = corner.outcome === "win" || corner.outcome === "draw";
        items.push({ width, draw: (left) => {
          spacing(ctx, 1.2 * u);
          pill(ctx, label, left + width / 2, mid - 17 * u, 34 * u, corner.outcome === "win" ? p.win : corner.outcome === "draw" ? p.draw : p.panelStrong, win ? "#ffffff" : p.muted, face, halfW);
          spacing(ctx, 0);
        } });
      } else if (corner.odds) {
        const face = display(25 * u);
        ctx.font = face;
        const width = ctx.measureText(corner.odds).width + 30 * u;
        items.push({ width, draw: (left) => pill(ctx, corner.odds!, left + width / 2, mid - 18 * u, 36 * u, p.panelStrong, index === 0 ? p.f1 : p.f2, face) });
      }
      if (corner.form?.length) {
        const width = formWidth(corner.form, 28 * u);
        items.push({ width, draw: (left) => formSquares(ctx, corner.form!, left, mid, 28 * u, p, "left") });
      }
      const gap = 14 * u;
      let left = axes[index] - (items.reduce((sum, item) => sum + item.width, 0) + gap * Math.max(0, items.length - 1)) / 2;
      for (const item of items) { item.draw(left); left += item.width + gap; }
    });
    if (g.marketHeading && corners.some((c) => c.odds)) {
      ctx.fillStyle = p.faint;
      ctx.font = text(700, 13 * u);
      spacing(ctx, 2.4 * u);
      centered(ctx, upper(g.marketHeading), cx, mid, middleW - 10 * u);
      spacing(ctx, 0);
    }
    y = mid + 18 * u;
  }
  y += 30 * u;

  // The pick and the share bars.
  if (g.pick) {
    const boxH = 64 * u;
    const color = stateColor(p, g.pick.state);
    const mid = y + boxH / 2;
    roundRect(ctx, colX0, y, colW, boxH, 10 * u);
    ctx.fillStyle = p.panelStrong;
    ctx.fill();
    const chipFace = text(800, 15 * u);
    const heading = upper(g.pick.heading);
    ctx.font = chipFace;
    spacing(ctx, 1.8 * u);
    const chipW = ctx.measureText(heading).width + 30 * u;
    roundRect(ctx, colX0 + 16 * u, mid - 17 * u, chipW, 34 * u, 6 * u);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = stateInk(p, g.pick.state);
    centered(ctx, heading, colX0 + 16 * u + chipW / 2, mid);
    spacing(ctx, 0);
    const verdict = g.pick.state === "won" ? "RIGHT" : g.pick.state === "lost" ? "WRONG" : g.pick.state === "void" ? "VOID" : "";
    const verdictFace = text(800, 18 * u);
    ctx.font = verdictFace;
    const verdictW = verdict ? ctx.measureText(verdict).width + 44 * u : 0;
    if (verdict) {
      mark(ctx, colX1 - verdictW + 2 * u, mid, 13 * u, color, stateMark(g.pick.state));
      ctx.fillStyle = color;
      ctx.textAlign = "right";
      ctx.fillText(verdict, colX1 - 18 * u, middle(ctx, verdict, mid));
    }
    const pickedName = upper(corners[g.pick.side === "f1" ? 0 : 1].name);
    const line = g.pick.detail ? `${pickedName} · ${upper(g.pick.detail)}` : pickedName;
    const textX = colX0 + 16 * u + chipW + 18 * u;
    const used = sizeFor(ctx, line, colX1 - textX - verdictW - 18 * u, display, 30 * u, 18 * u);
    ctx.font = display(used);
    ctx.fillStyle = p.ink;
    ctx.textAlign = "left";
    fit(ctx, line, textX, middle(ctx, line, mid), colX1 - textX - verdictW - 18 * u, display, used, used);
    y += boxH + 18 * u;
  }
  for (const split of g.splits) {
    splitBar(ctx, split, colX0, y, colW, 64 * u, p, u, [axes[0], axes[1]]);
    y += 86 * u;
  }

  // The comparison table: figures on the corners' axes, the label between.
  ctx.font = display(30 * u * Math.max(scale, 0.7));
  const widest = Math.max(0, ...rows.flatMap((entry) => "row" in entry && !entry.row.shared ? [ctx.measureText(entry.row.f1).width, ctx.measureText(entry.row.f2).width] : []));
  const labelW = Math.max(middleW, axes[1] - axes[0] - widest - 60 * u);
  rows.forEach((entry, index) => {
    if ("heading" in entry) {
      const rowH = HEAD * scale;
      heading(ctx, entry.heading, colX0, colX1, y + rowH * 0.5, u, p, 15 * u * Math.max(scale, 0.8));
      y += rowH;
      return;
    }
    const rowH = ROW * scale;
    const mid = y + rowH / 2;
    const row = entry.row;
    if (index < rows.length - 1 && !("heading" in rows[index + 1])) {
      ctx.fillStyle = p.line;
      ctx.fillRect(colX0, y + rowH, colW, Math.max(1, 1.2 * u));
    }
    const valueFace = display(30 * u * Math.max(scale, 0.7));
    const labelFace = text(600, 15 * u * Math.max(scale, 0.8));
    if (row.shared) {
      ctx.fillStyle = p.muted;
      ctx.font = labelFace;
      ctx.textAlign = "left";
      const label = upper(row.label);
      fit(ctx, label, colX0 + 6 * u, middle(ctx, label, mid), colW * 0.74, (s) => text(600, s), 15 * u * Math.max(scale, 0.8), 11 * u);
      ctx.fillStyle = p.ink;
      ctx.font = valueFace;
      ctx.textAlign = "right";
      fit(ctx, row.shared, colX1 - 6 * u, middle(ctx, row.shared, mid), colW * 0.22, display, 30 * u * Math.max(scale, 0.7), 14 * u);
      y += rowH;
      return;
    }
    ctx.fillStyle = p.muted;
    ctx.font = labelFace;
    spacing(ctx, 1.6 * u);
    centered(ctx, upper(row.label), cx, mid, labelW);
    spacing(ctx, 0);
    sides.forEach((side, i) => {
      const value = row[side];
      ctx.font = valueFace;
      const valueW = Math.min(halfW * 0.8, ctx.measureText(value).width);
      if (row.edge === side) {
        // The better figure sits on a chip in its corner's colour.
        const valueCap = capHeight(ctx, valueFace);
        ctx.save();
        ctx.globalAlpha = p.dark ? 0.2 : 0.12;
        ctx.fillStyle = i === 0 ? p.f1 : p.f2;
        const padY = Math.min(7 * u, (rowH - valueCap) / 2 - 2 * u);
        roundRect(ctx, axes[i] - valueW / 2 - 14 * u, mid - valueCap / 2 - padY, valueW + 28 * u, valueCap + padY * 2, 7 * u);
        ctx.fill();
        ctx.restore();
        ctx.font = valueFace;
      }
      ctx.fillStyle = row.edge === side ? (i === 0 ? p.f1 : p.f2) : p.ink;
      centered(ctx, value, axes[i], mid, halfW * 0.8);
    });
    y += rowH;
  });

  if (judges.length) {
    heading(ctx, "Judges’ scorecards", colX0, colX1, y + 22 * u * scale, u, p, 15 * u * Math.max(scale, 0.8));
    const colWidth = colW / judges.length;
    const scoreFace = display(44 * u * Math.max(scale, 0.6));
    const scoreMid = y + 98 * u * scale;
    judges.forEach((judge, index) => {
      const jx = colX0 + colWidth * index + colWidth / 2;
      ctx.fillStyle = p.muted;
      ctx.font = text(600, 15 * u);
      spacing(ctx, 1.2 * u);
      centered(ctx, upper(judge.name), jx, y + 56 * u * scale, colWidth - 16 * u);
      spacing(ctx, 0);
      ctx.font = scoreFace;
      ctx.fillStyle = p.faint;
      centered(ctx, "–", jx, scoreMid);
      const base = middle(ctx, "0", scoreMid);
      ctx.textAlign = "right";
      ctx.fillStyle = judge.f1 > judge.f2 ? p.f1 : p.faint;
      ctx.fillText(String(judge.f1), jx - 16 * u, base);
      ctx.textAlign = "left";
      ctx.fillStyle = judge.f2 > judge.f1 ? p.f2 : p.faint;
      ctx.fillText(String(judge.f2), jx + 16 * u, base);
    });
  }
  footer(ctx, w, h, u, pad, p, g.footer);
}

/** A picture set back: grey and darker, still solid. */
function setBack(ctx: Ctx) {
  // Older Safari has no canvas filters; there the picture fades instead.
  const filtered = ctx as Ctx & { filter?: string };
  if (typeof filtered.filter === "string") filtered.filter = "grayscale(1) brightness(0.62)";
  else ctx.globalAlpha = 0.5;
}

/** A corner set back: it lost, or the pick went the other way. */
const dimmed = (g: VersusGraphic, index: number) => {
  const corner = index === 0 ? g.f1 : g.f2;
  return corner.outcome === "loss" || Boolean(g.pick && g.pick.side !== (index === 0 ? "f1" : "f2"));
};

// ---------------------------------------------------------------------------
// One fighter

function renderFighter(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: FighterGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 48 * u;
  backdrop(ctx, w, h, p);
  const footTop = footerTop(h, u, pad);
  const bottom = footTop - 16 * u;
  const hasPhoto = Boolean(g.photo);
  const photoW = hasPhoto ? (format === "landscape" ? w * 0.36 : w * 0.42) : 0;
  if (g.photo) {
    cage(ctx, pad + photoW / 2, (pad + footTop) / 2, Math.min(photoW * 0.6, (footTop - pad) * 0.44), u, p);
    // Standing on the footer's rule, cut clean at the column's edge.
    if (g.photo.kind === "full") cutout(ctx, g.photo.image, 0, pad, pad + photoW + 10 * u, footTop - pad, "center", 0.92);
    else roundel(ctx, g.photo.image, pad + (photoW - 20 * u) / 2, pad + 40 * u + (photoW - 20 * u) / 2, photoW - 20 * u, p.accent);
  }
  const textX = hasPhoto ? pad + photoW + 28 * u : pad;
  const textW = w - textX - pad;
  const eyebrowFace = text(700, 18 * u);
  let y = pad + capHeight(ctx, eyebrowFace);
  ctx.textAlign = "left";
  ctx.fillStyle = p.accent;
  label(ctx, upper(g.eyebrow), textX, y, eyebrowFace, 3.6 * u, textW);
  y += 20 * u;
  // The name, as big as its length allows, over two lines when long.
  const capRatio = capHeight(ctx, display(100)) / 100 || 0.72;
  const words = upper(g.name).split(" ");
  const rankRoom = (size: number) => g.rank ? rankWidth(ctx, g.rank, size * capRatio) + size * 0.16 : 0;
  const oneLine = sizeFor(ctx, words.join(" "), textW - rankRoom(110 * u), display, 120 * u, 56 * u);
  // Two lines when long, and a Jr. or III stays with the surname.
  const tail = words.length > 2 && /^(?:JR|SR)\.?$|^(?:II|III|IV)$/.test(words.at(-1)!) ? 2 : 1;
  const lines = oneLine < 90 * u && words.length > tail ? [words.slice(0, -tail).join(" "), words.slice(-tail).join(" ")] : [words.join(" ")];
  const size = lines.length > 1 ? Math.min(...lines.map((line) => sizeFor(ctx, line, textW - rankRoom(110 * u), display, 120 * u, 48 * u))) : oneLine;
  const cap = size * capRatio;
  for (const [index, line] of lines.entries()) {
    if (index) y += size * 0.16;
    y += cap;
    let x = textX;
    if (g.rank && index === lines.length - 1) x += rankBox(ctx, g.rank, x, y - cap / 2, cap, p) + size * 0.16;
    ctx.fillStyle = p.ink;
    ctx.textAlign = "left";
    fit(ctx, line, x, y, textX + textW - x, display, size, size * 0.6);
  }
  if (g.nickname || g.flag) {
    const face = text(500, 26 * u);
    const mid = y + 26 * u + capHeight(ctx, face) / 2;
    let x = textX;
    const drawn = flag(ctx, g.flag, x, mid, 34 * u, "left");
    if (drawn) x += drawn + 12 * u;
    if (g.nickname) {
      ctx.fillStyle = p.muted;
      ctx.font = face;
      ctx.textAlign = "left";
      const nick = `“${g.nickname}”`;
      fit(ctx, nick, x, middle(ctx, nick, mid), textX + textW - x, (s) => text(500, s), 26 * u, 16 * u);
    }
    y = mid + 20 * u;
  }
  y += 26 * u;
  let bx = textX;
  const badgeFace = text(700, 16 * u);
  for (const badge of g.badges) {
    const belt = badge.startsWith("Champion") || badge.startsWith("Interim");
    ctx.font = badgeFace;
    spacing(ctx, 1.2 * u);
    const bw = Math.min(textW, ctx.measureText(upper(badge)).width + 28 * u);
    if (bx + bw > textX + textW) { bx = textX; y += 46 * u; }
    roundRect(ctx, bx, y, bw, 36 * u, 6 * u);
    ctx.fillStyle = belt ? p.gold : p.panelStrong;
    ctx.fill();
    ctx.fillStyle = belt ? "#111111" : p.ink;
    centered(ctx, upper(badge), bx + bw / 2, y + 18 * u, bw - 16 * u);
    spacing(ctx, 0);
    bx += bw + 10 * u;
  }
  if (g.badges.length) y += 64 * u;
  if (g.facts.length) {
    const cols = Math.min(g.facts.length, format === "landscape" ? 4 : 2);
    const colW = textW / cols;
    g.facts.forEach((fact, index) => {
      const fx = textX + (index % cols) * colW;
      const fy = y + Math.floor(index / cols) * 78 * u;
      ctx.fillStyle = p.faint;
      ctx.textAlign = "left";
      label(ctx, upper(fact.label), fx, fy + 12 * u, text(600, 15 * u), 1.6 * u);
      ctx.fillStyle = p.ink;
      fit(ctx, upper(fact.value), fx, fy + 56 * u, colW - 12 * u, display, 40 * u, 22 * u);
    });
    y += Math.ceil(g.facts.length / cols) * 78 * u + 6 * u;
  }
  if (g.form?.length) {
    ctx.fillStyle = p.faint;
    ctx.textAlign = "left";
    label(ctx, "LAST FIVE", textX, y + 12 * u, text(600, 15 * u), 1.6 * u);
    formSquares(ctx, g.form.map((entry) => entry.outcome), textX, y + 44 * u, 36 * u, p, "left");
    ctx.fillStyle = p.muted;
    ctx.textAlign = "left";
    fit(ctx, upper(g.form.map((entry) => entry.label).join(" · ")), textX, y + 94 * u, textW, (s) => text(600, s), 17 * u, 12 * u);
    y += 122 * u;
  }
  if (g.stats.length) {
    const rowH = Math.min(66 * u, (bottom - y) / g.stats.length);
    const scale = Math.min(1, rowH / (66 * u));
    // One size for every label, the longest deciding it.
    const labelSize = Math.min(...g.stats.map((stat) => sizeFor(ctx, stat.label, textW * 0.66 - (stat.rank ? 78 * u : 0), (s) => text(600, s), 19 * u * Math.max(scale, 0.75), 15 * u)));
    for (const stat of g.stats) {
      const mid = y + rowH / 2;
      ctx.fillStyle = p.line;
      ctx.fillRect(textX, y, textW, Math.max(1, 1.2 * u));
      let lx = textX;
      if (stat.rank) {
        const top1 = stat.rank === "#1" || stat.rank === "#T1";
        const face = display(24 * u * Math.max(scale, 0.7));
        ctx.font = face;
        const bw = Math.max(62 * u * scale, ctx.measureText(stat.rank).width + 22 * u);
        const bh = rowH * 0.6;
        roundRect(ctx, textX, mid - bh / 2, bw, bh, 6 * u);
        ctx.fillStyle = top1 ? p.gold : p.panelStrong;
        ctx.fill();
        ctx.fillStyle = top1 ? "#111111" : p.ink;
        centered(ctx, stat.rank, textX + bw / 2, mid);
        lx += bw + 16 * u;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = p.ink;
      fit(ctx, stat.label, lx, stat.detail ? mid - 2 * u : middle(ctx, stat.label, mid), textW * 0.66 - (lx - textX), (s) => text(600, s), labelSize, labelSize);
      if (stat.detail) {
        ctx.fillStyle = p.faint;
        fit(ctx, stat.detail, lx, mid + 20 * u * Math.max(scale, 0.75), textW * 0.64 - (lx - textX), (s) => text(500, s), 14 * u * Math.max(scale, 0.75), 10 * u);
      }
      ctx.textAlign = "right";
      ctx.fillStyle = p.ink;
      const valueFace = display(34 * u * Math.max(scale, 0.7));
      ctx.font = valueFace;
      fit(ctx, stat.value, textX + textW, middle(ctx, stat.value, mid), textW * 0.33, display, 34 * u * Math.max(scale, 0.7), 18 * u);
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
    const line = upper(date.small);
    const size = sizeFor(ctx, line, w * 0.8, (s) => text(600, s), 19 * u, 13 * u);
    label(ctx, line, cx, bottom, text(600, size), 1.4 * u, w * 0.8);
  }
  const base = bottom - (date.small ? 34 * u : 0);
  const face = display(62 * u);
  ctx.fillStyle = p.ink;
  ctx.font = face;
  ctx.fillText(upper(date.big), cx, base);
  return base - capHeight(ctx, face) - 24 * u;
}

/** A record in muted type and a price in ink on one line, anchored at `x`. */
function pair(ctx: Ctx, first: string, second: string, x: number, y: number, align: "left" | "right", size: number, p: Palette) {
  const joiner = first && second ? "   " : "";
  const firstFace = text(600, size * 0.8);
  ctx.font = firstFace;
  const firstW = ctx.measureText(first + joiner).width;
  ctx.font = display(size);
  const secondW = ctx.measureText(second).width;
  const left = align === "left" ? x : x - firstW - secondW;
  ctx.textAlign = "left";
  ctx.font = firstFace;
  ctx.fillStyle = p.muted;
  ctx.fillText(first + joiner, left, y);
  ctx.font = display(size);
  ctx.fillStyle = p.ink;
  ctx.fillText(second, left + firstW, y);
}

function renderCardList(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 48 * u;
  backdrop(ctx, w, h, p);
  const footTop = footerTop(h, u, pad);
  const headBottom = masthead(ctx, u, pad, p, pad, w - pad, g.eyebrow, g.title, g.subtitle, format === "landscape" ? 84 * u : 104 * u);
  const dateTop = dateBlock(ctx, w, u, footTop - 26 * u, p, g.date);
  const top = headBottom + 30 * u;
  const bottom = dateTop;
  const splitCount = Math.max(0, ...g.rows.map((row) => row.splits.length));
  const hasSub = g.rows.some((row) => row.f1.sub || row.f2.sub || row.f1.odds || row.f2.odds || row.pick || row.result);
  const weightOf = (index: number) => (index === 0 && g.rows.length > 2 ? 1.3 : 1);
  const startsGroup = (index: number) => Boolean(g.rows[index].group && g.rows[index].group !== g.rows[index - 1]?.group);
  const groups = g.rows.filter((_row, index) => startsGroup(index)).length;
  const total = g.rows.reduce((sum, _row, index) => sum + weightOf(index), 0) + groups * 0.45;
  // A row's height in units of its name size.
  const perSize = 0.3 + 0.36 + 0.78 + (hasSub ? 0.6 : 0) + splitCount * 1.05 + 0.5;
  const unit = Math.min((bottom - top) / Math.max(1, total), 70 * u * perSize);
  let y = top + Math.max(0, (bottom - top - unit * total) / 2);
  const capRatio = capHeight(ctx, display(100)) / 100 || 0.72;
  const flags = g.rows.some((row) => flagWidth(ctx, row.f1.flag, 30 * u) || flagWidth(ctx, row.f2.flag, 30 * u));
  const mid = w / 2;
  // Every bout's names at one size, the main event's a step up: a long name
  // on one bout shrinks the rest with it rather than standing out.
  const sizes = g.rows.map((row, index) => {
    const s = (unit * weightOf(index)) / perSize;
    const cap = s * capRatio;
    const flagRoom = flags ? cap * 1.5 + 18 * u : 0;
    const room = (side: "f1" | "f2") => mid - s * 0.5 - pad - flagRoom - (row[side].rank ? rankWidth(ctx, row[side].rank!, cap) + s * 0.2 : 0);
    return Math.min(sizeFor(ctx, upper(row.f1.name), room("f1"), display, s, s * 0.5), sizeFor(ctx, upper(row.f2.name), room("f2"), display, s, s * 0.5));
  });
  const undercard = Math.min(...sizes.filter((_size, index) => weightOf(index) === 1));
  g.rows.forEach((row, index) => {
    if (startsGroup(index)) {
      heading(ctx, row.group!, pad, w - pad, y + unit * 0.22, u, p, 15 * u);
      y += unit * 0.45;
    } else if (index > 0) {
      ctx.fillStyle = p.line;
      ctx.fillRect(pad + w * 0.1, y, w - pad * 2 - w * 0.2, Math.max(1, 1.2 * u));
    }
    const rowH = unit * weightOf(index);
    const s = rowH / perSize;
    const nameSize = weightOf(index) === 1 && Number.isFinite(undercard) ? undercard : sizes[index];
    const cap = nameSize * capRatio;
    const gap = Math.max(s * 0.5, nameSize * 0.55);
    const metaFace = text(700, Math.max(11 * u, s * 0.3));
    const metaY = y + s * 0.3 + capHeight(ctx, metaFace);
    ctx.textAlign = "center";
    ctx.fillStyle = row.title ? p.gold : p.accent;
    label(ctx, upper(row.meta), mid, metaY, metaFace, s * 0.05, w * 0.7);
    const nameY = metaY + s * 0.36 + cap;
    const nameMid = nameY - cap / 2;
    const flagRoom = flags ? cap * 1.5 + 18 * u : 0;
    for (const side of ["f1", "f2"] as const) {
      const c = row[side];
      const left = side === "f1";
      const picked = row.pick?.side === side;
      const dim = (row.winner && row.winner !== side) || (row.pick && !picked);
      const space = mid - gap - pad - flagRoom - (c.rank ? rankWidth(ctx, c.rank, cap) + s * 0.2 : 0);
      ctx.font = display(nameSize);
      const textW = Math.min(space, ctx.measureText(upper(c.name)).width);
      const anchor = left ? mid - gap : mid + gap;
      ctx.fillStyle = picked ? stateColor(p, row.pick!.state) : dim ? p.faint : p.ink;
      ctx.textAlign = left ? "right" : "left";
      fit(ctx, upper(c.name), anchor, nameY, space, display, nameSize, nameSize * 0.8);
      if (c.rank) rankBox(ctx, c.rank, left ? anchor - textW - s * 0.2 - rankWidth(ctx, c.rank, cap) : anchor + textW + s * 0.2, nameMid, cap, p);
      if (flags) flag(ctx, c.flag, left ? pad : w - pad, nameMid, cap * 1.25, left ? "left" : "right");
      // Under the name: the pick, or the record and price.
      if (hasSub) {
        const subSize = Math.max(14 * u, s * 0.4);
        const subY = nameY + s * 0.18 + subSize * 0.8;
        if (picked) {
          const color = stateColor(p, row.pick!.state);
          const line = ["MY PICK", row.pick!.detail ? upper(row.pick!.detail) : null].filter(Boolean).join(" · ");
          ctx.font = text(700, subSize * 0.8);
          const tw = ctx.measureText(line).width;
          const r = subSize * 0.36;
          const markX = left ? anchor - tw - r - 8 * u : anchor + r;
          mark(ctx, markX, middle(ctx, line, subY - subSize * 0.3), r, color, row.pick!.state === "lost" ? "cross" : "check", stateInk(p, row.pick!.state));
          ctx.fillStyle = color;
          ctx.textAlign = left ? "right" : "left";
          ctx.fillText(line, left ? anchor : anchor + r * 2 + 8 * u, subY);
        } else {
          pair(ctx, c.sub ?? "", c.odds ?? "", anchor, subY, left ? "right" : "left", subSize, p);
        }
      }
    }
    ctx.fillStyle = p.accent;
    ctx.font = display(Math.max(16 * u, nameSize * 0.42));
    centered(ctx, "VS", mid, nameMid);
    if (row.result) {
      ctx.fillStyle = p.win;
      ctx.textAlign = "center";
      fit(ctx, upper(row.result), mid, nameY + s * 0.62, gap * 2.6, (v) => text(700, v), Math.max(11 * u, s * 0.28), 9 * u);
    }
    let barY = nameY + (hasSub ? s * 0.92 : s * 0.4);
    for (const split of row.splits) {
      splitBar(ctx, split, pad + flagRoom, barY, w - (pad + flagRoom) * 2, s * 0.86, p, u);
      barY += s * 1.05;
    }
    y += rowH;
  });
  footer(ctx, w, h, u, pad, p, g.footer);
}

function renderCardFaces(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 46 * u;
  backdrop(ctx, w, h, p);
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
      ctx.fillStyle = p.raised;
      ctx.fillRect(px, ty, each, photoH);
      ctx.fillStyle = p.panel;
      ctx.fillRect(px, ty, each, photoH);
      if (c.photo) coverTop(ctx, c.photo.image, px, ty, each, photoH);
      else {
        ctx.fillStyle = p.faint;
        ctx.font = display(Math.min(each, photoH) * 0.42);
        centered(ctx, upper(c.surname.slice(0, 1)), px + each / 2, ty + photoH / 2);
      }
      if (dim) {
        ctx.fillStyle = p.dark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.6)";
        ctx.fillRect(px, ty, each, photoH);
      }
      // A share or a price on a solid strip across the foot of the picture.
      const figure = row.splits[0] ? `${row.splits[0][side]}%` : c.odds ?? null;
      if (figure) {
        const stripH = Math.min(each * 0.3, photoH * 0.24);
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(px, ty + photoH - stripH, each, stripH);
        ctx.fillStyle = row.splits[0] ? (side === "f1" ? p.f1 : p.f2) : "#ffffff";
        ctx.font = display(stripH * 0.62);
        centered(ctx, figure, px + each / 2, ty + photoH - stripH / 2);
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
    const vsText = "  VS  ";
    const n1 = upper(row.f1.surname);
    const n2 = upper(row.f2.surname);
    const size = sizeFor(ctx, `${n1}${vsText}${n2}`, tw, display, nameSize, nameSize * 0.5);
    ctx.font = display(size);
    const w1 = ctx.measureText(n1).width;
    const w2 = ctx.measureText(n2).width;
    ctx.font = display(size * 0.7);
    const wv = ctx.measureText(vsText).width;
    let left = cx - (w1 + wv + w2) / 2;
    const base = ty + photoH + captionH * 0.5;
    ctx.textAlign = "left";
    const nameColor = (side: "f1" | "f2") => row.pick ? (row.pick.side === side ? stateColor(p, row.pick.state) : p.faint) : row.winner && row.winner !== side ? p.faint : p.ink;
    ctx.font = display(size);
    ctx.fillStyle = nameColor("f1");
    ctx.fillText(n1, left, base);
    left += w1;
    ctx.font = display(size * 0.7);
    ctx.fillStyle = p.accent;
    ctx.fillText(vsText, left, base);
    left += wv;
    ctx.font = display(size);
    ctx.fillStyle = nameColor("f2");
    ctx.fillText(n2, left, base);
    ctx.textAlign = "center";
    ctx.fillStyle = row.title ? p.gold : p.accent;
    const meta = row.result ? `${row.meta} · ${row.result}` : row.pick?.detail ? `${row.meta} · pick: ${row.pick.detail}` : row.meta;
    const metaSize = sizeFor(ctx, upper(meta), tw, (v) => text(700, v), main ? 15 * u : 12.5 * u, 9 * u);
    label(ctx, upper(meta), cx, base + captionH * 0.34, text(700, metaSize), metaSize * 0.12, tw);
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
  const pad = 48 * u;
  backdrop(ctx, w, h, p);
  const footTop = footerTop(h, u, pad);
  const wide = format === "landscape";
  const x0 = wide ? w * 0.16 : pad;
  const x1 = wide ? w * 0.84 : w - pad;
  const cx = (x0 + x1) / 2;
  const headBottom = masthead(ctx, u, pad, p, x0, x1, g.eyebrow, g.title, "", wide ? 64 * u : 72 * u);
  // The combined price, as large as the space allows.
  let y = headBottom + 30 * u;
  const priceSize = Math.min(wide ? 130 * u : 160 * u, (footTop - y) * 0.22);
  ctx.textAlign = "center";
  ctx.fillStyle = p.accent;
  y += capHeight(ctx, display(priceSize));
  fit(ctx, g.price, cx, y, x1 - x0, display, priceSize, priceSize * 0.6);
  const oddsFace = text(700, 17 * u);
  y += 22 * u + capHeight(ctx, oddsFace);
  ctx.fillStyle = p.muted;
  label(ctx, g.legs.length > 1 ? "COMBINED ODDS" : "ODDS", cx, y, oddsFace, 3 * u);
  y += 34 * u;

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
  roundRect(ctx, x0, tTop, x1 - x0, ticketH, 18 * u);
  ctx.fillStyle = p.panelStrong;
  ctx.fill();
  // The notches are the backdrop's colour, not cut out: a cut-out would
  // leave transparent holes in the exported picture.
  ctx.fillStyle = p.bg;
  ctx.beginPath();
  ctx.arc(x0, notchY, notchR, 0, Math.PI * 2);
  ctx.arc(x1, notchY, notchR, 0, Math.PI * 2);
  ctx.fill();
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
    // The selection, its tick and its price share one line.
    const selectionFace = display(34 * u * Math.max(scale, 0.6));
    const base = ly + legH * 0.46;
    const mid = base - capHeight(ctx, selectionFace) / 2;
    mark(ctx, x0 + 30 * u + r, mid, r, leg.state === "pending" ? p.panelStrong : stateColor(p, leg.state), stateMark(leg.state), leg.state === "pending" ? p.muted : "#ffffff");
    const tx = x0 + 30 * u + r * 2 + 18 * u;
    ctx.textAlign = "right";
    ctx.fillStyle = p.ink;
    ctx.font = selectionFace;
    ctx.fillText(leg.price, x1 - 28 * u, base);
    const priceW = ctx.measureText(leg.price).width + 44 * u;
    ctx.textAlign = "left";
    ctx.fillStyle = leg.state === "lost" || leg.state === "void" ? p.faint : p.ink;
    fit(ctx, upper(leg.selection), tx, base, x1 - tx - priceW, display, 34 * u * Math.max(scale, 0.6), 16 * u);
    ctx.fillStyle = p.faint;
    fit(ctx, `${leg.bout} · ${leg.event}`, tx, base + 36 * u * Math.max(scale, 0.75), x1 - tx - priceW, (s) => text(500, s), 16 * u * Math.max(scale, 0.75), 11 * u);
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
    label(ctx, name, x, sy + 30 * u, text(700, 16 * u), 2.5 * u);
    ctx.fillStyle = color;
    fit(ctx, value, x, sy + 80 * u, third - 12 * u, display, 48 * u, 22 * u);
  });
  // A stamp across a settled slip.
  if (g.state !== "pending") {
    const stamp = upper(g.state === "won" ? "Winner" : g.state === "lost" ? "Lost" : "Void");
    ctx.save();
    // On the ticket's top edge, clear of the first leg's price.
    ctx.translate(x1 - (x1 - x0) * 0.2, tTop - 8 * u);
    ctx.rotate(-0.12);
    ctx.font = display(52 * u);
    spacing(ctx, 6 * u);
    const sw = ctx.measureText(stamp).width + 40 * u;
    ctx.strokeStyle = stateColor(p, g.state);
    ctx.lineWidth = 5 * u;
    ctx.globalAlpha = 0.9;
    roundRect(ctx, -sw / 2, -38 * u, sw, 72 * u, 10 * u);
    ctx.stroke();
    ctx.fillStyle = stateColor(p, g.state);
    centered(ctx, stamp, 0, -2 * u);
    spacing(ctx, 0);
    ctx.restore();
  }
  ctx.textAlign = "center";
  ctx.fillStyle = p.faint;
  fit(ctx, g.placed, cx, tTop + ticketH + 30 * u, x1 - x0, (s) => text(500, s), 16 * u, 11 * u);
  footer(ctx, w, h, u, pad, p, g.footer);
}

/** Drawn at twice the layout size, so type and edges stay sharp on a phone's
 *  screen and after a feed recompresses the image. */
export const SCALE = 2;

export function renderGraphic(canvas: HTMLCanvasElement, graphic: Graphic, format: Format, theme: Theme) {
  const { width, height } = SIZES[format];
  canvas.width = width * SCALE;
  canvas.height = height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
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
