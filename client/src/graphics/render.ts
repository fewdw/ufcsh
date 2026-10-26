import {
  backdrop, badge, bar, barTop, capHeight, centered, coverTop, cutout, display, fit, flag, flagWidth, formSquares, heading, label,
  mark, middle, PALETTES, rankBox, rankWidth, roundRect, sizeFor, slanted, splitBar, spacing, stripes, text,
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
export type Format = "square" | "portrait" | "story" | "landscape";

export const SIZES: Record<Format, { width: number; height: number; label: string }> = {
  square: { width: 1080, height: 1080, label: "Square · 2160 × 2160" },
  portrait: { width: 1080, height: 1350, label: "Portrait · 2160 × 2700" },
  story: { width: 1080, height: 1920, label: "Story · 2160 × 3840" },
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
  /** "12", "C" or "IC", drawn as a chip beside the name. */
  rank?: string | null;
  flag?: string | null;
  /** Short lines under the name in the table's head: records. */
  lines: string[];
  outcome?: Outcome;
};

/** One line of the comparison: a figure per corner, one shared figure, or each corner's last five. */
export type CompareRow = { shared?: string; label: string; f1: string; f2: string; edge: "f1" | "f2" | null; form?: { f1: Outcome[]; f2: Outcome[] } };

export type VersusGraphic = {
  kind: "versus";
  /** The event's square badge: ["UFC", "334"]. */
  badge: string[];
  /** The billing under the names: "Lightweight bout · 5 rounds". */
  bout: string;
  f1: Corner;
  f2: Corner;
  /** How it ended, beside the billing on a result. */
  outcome?: { chip: string; detail: string; tone: "win" | "draw" | "nc" } | null;
  pick?: (PickMark & { heading: string }) | null;
  splits: Split[];
  /** Titled groups of rows; an untitled group sits straight under the names. */
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
  /** The event's square badge, and its billing beside it: "Moicano vs. Nolan". */
  badge: string[];
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

/** A card's head, as a poster's: the event's badge, and beside it the
 *  billing, the headline and a line under it. Returns its bottom. */
function cardHead(ctx: Ctx, w: number, u: number, pad: number, p: Palette, g: CardGraphic, wide: boolean): number {
  const size = (wide ? 128 : 140) * u;
  badge(ctx, g.badge, pad, pad, size, p);
  const x = pad + size + 34 * u;
  const room = w - pad - x;
  const eyebrowFace = text(700, 18 * u);
  const subtitleFace = text(500, 19 * u);
  const titleSize = sizeFor(ctx, upper(g.title), room, display, wide ? 92 * u : 100 * u, 48 * u);
  const titleCap = capHeight(ctx, display(titleSize));
  const parts = [g.eyebrow ? capHeight(ctx, eyebrowFace) + 20 * u : 0, titleCap, g.subtitle ? 22 * u + capHeight(ctx, subtitleFace) : 0];
  let y = pad + Math.max(0, (size - parts.reduce((sum, part) => sum + part, 0)) / 2);
  ctx.textAlign = "left";
  if (g.eyebrow) {
    y += capHeight(ctx, eyebrowFace);
    ctx.fillStyle = p.accent;
    label(ctx, upper(g.eyebrow), x, y, eyebrowFace, 3 * u, room);
    y += 20 * u;
  }
  y += titleCap;
  ctx.fillStyle = p.ink;
  fit(ctx, upper(g.title), x, y, room, display, titleSize, titleSize);
  if (g.subtitle) {
    y += 22 * u + capHeight(ctx, subtitleFace);
    ctx.fillStyle = p.muted;
    fit(ctx, g.subtitle, x, y, room, (s) => text(500, s), 19 * u, 13 * u);
  }
  return pad + size;
}

// ---------------------------------------------------------------------------
// Two fighters

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A labelled chip and a line beside it: the result, or someone's pick. */
type Tag = { chip: string; fill: string; ink: string; line: string };

function renderVersus(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: VersusGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 56 * u;
  backdrop(ctx, w, h, p);
  const floor = barTop(h, u);
  const corners = [g.f1, g.f2];
  const sides = ["f1", "f2"] as const;
  const wide = format === "landscape";
  const photos = corners.some((c) => c.photo);
  const judges = g.judges ?? [];
  const entries = g.sections.flatMap((section) => [...(section.title ? [{ heading: section.title } as const] : []), ...section.rows.map((row) => ({ row }))]);
  const subs = corners.map((c) => [c.nickname ? `“${c.nickname}”` : null, ...c.lines.map(upper)].filter((line): line is string => Boolean(line)));
  const subLines = Math.max(...subs.map((list) => list.length));
  const panel = entries.length > 0 || g.splits.length > 0 || judges.length > 0 || subLines > 0;
  // Landscape sets figures beside the poster; a head of records alone goes under it.
  const beside = wide && (entries.length > 0 || g.splits.length > 0 || judges.length > 0);

  // The panel's parts at full size. All but its margins shrink together to fit.
  const HEADER = 54 * u + subLines * 28 * u;
  const ROW = 56 * u;
  const HEAD = 56 * u;
  const SPLIT = 104 * u;
  const JUDGES = 156 * u;
  const MARGIN = 40 * u;
  const flex = HEADER + entries.reduce((sum, entry) => sum + ("heading" in entry ? HEAD : ROW), 0) + g.splits.length * SPLIT + (judges.length ? JUDGES : 0);

  // The poster above (or, in landscape, beside) the panel: badge, pictures, names.
  const heroW = beside ? Math.round(w * 0.5) : w;
  let heroBottom = floor;
  let k = 1;
  if (beside) k = clamp((floor - MARGIN * 2) / flex, 0.55, 1.1);
  // Its type is set below; the poster's share is fixed here.
  const posterShare = photos ? (format === "story" ? 0.5 : format === "square" ? 0.48 : format === "portrait" ? 0.42 : 0.4) : 0;

  // The names: one size for both, the second led by VS, then the billing.
  const capRatio = capHeight(ctx, display(100)) / 100 || 0.72;
  const names = corners.map((c) => upper(c.surname));
  const tags: Tag[] = [];
  if (g.outcome) tags.push({ chip: upper(g.outcome.chip), fill: g.outcome.tone === "win" ? p.win : g.outcome.tone === "draw" ? p.draw : p.faint, ink: "#ffffff", line: upper(g.outcome.detail) });
  if (g.pick) {
    const verdict = g.pick.state === "won" ? " · RIGHT" : g.pick.state === "lost" ? " · WRONG" : g.pick.state === "void" ? " · VOID" : "";
    const picked = upper(corners[g.pick.side === "f1" ? 0 : 1].surname);
    tags.push({ chip: upper(g.pick.heading) + verdict, fill: g.pick.state === "pending" ? p.accent : stateColor(p, g.pick.state), ink: g.pick.state === "pending" ? p.onAccent : "#ffffff", line: [picked, g.pick.detail ? upper(g.pick.detail) : null].filter(Boolean).join(" · ") });
  }
  const boutFace = text(800, 22 * u);
  const boutCap = capHeight(ctx, boutFace);
  const TAG = 42 * u;
  const supFor = (size: number) => Math.max(20 * u, size * capRatio * 0.3);
  const supWidth = (index: number, size: number) => {
    const c = corners[index];
    const sup = supFor(size);
    const parts = [c.rank ? rankWidth(ctx, c.rank, sup) : 0, flagWidth(ctx, c.flag, sup * 1.2), g.pick?.side === sides[index] ? sup : 0].filter(Boolean);
    return parts.length ? size * 0.08 + parts.reduce((sum, part) => sum + part, 0) + sup * 0.3 * (parts.length - 1) : 0;
  };
  const vsWidth = (size: number) => { ctx.font = display(size * 0.5); return ctx.measureText("VS").width + size * 0.12; };
  const lineWidth = (index: number, size: number) => { const lead = index ? vsWidth(size) : 0; ctx.font = display(size); return lead + ctx.measureText(names[index]).width + supWidth(index, size); };
  const blockHeight = (size: number) => size * capRatio * 2 + size * 0.14 + 30 * u + boutCap + tags.length * (TAG + 20 * u);
  if (panel && !beside) {
    // Without pictures the poster needs only the badge and names of a fair size.
    const least = photos ? h * posterShare : pad + 180 * u + blockHeight(96 * u) + 54 * u;
    k = clamp((floor - least - MARGIN * 2) / flex, 0.56, 1);
    heroBottom = floor - flex * k - MARGIN * 2;
  }
  const nameRoom = beside ? heroW - pad * 2 : photos ? (wide ? w * 0.5 : w * 0.78) : w - pad * 2;
  const blockBottom = heroBottom - (photos ? 46 : 54) * u;
  let badgeSize = (wide ? 128 : format === "square" ? 132 : 150) * u;
  // Over pictures the names keep to the poster's lower part, below the faces.
  const busts = corners.every((c) => !c.photo || c.photo.kind === "head");
  const blockLimit = photos ? heroBottom * (busts ? 0.3 : format === "square" ? 0.42 : 0.38) + tags.length * (TAG + 20 * u) : Infinity;
  const fits = (size: number) => Math.max(lineWidth(0, size), lineWidth(1, size)) <= nameRoom && blockHeight(size) <= Math.min(blockLimit, blockBottom - (badgeSize ? pad + badgeSize + 30 * u : pad));
  let size = (photos ? (format === "story" ? 140 : wide ? 112 : 128) : 150) * u;
  while (size > 64 * u && !fits(size)) size -= u;
  // Where even small names would meet the badge, the badge shrinks, then gives way.
  while (!fits(size) && badgeSize > 100 * u) badgeSize -= 2 * u;
  if (!fits(size)) {
    badgeSize = 0;
    while (size > 44 * u && !fits(size)) size -= u;
  }
  const cap = size * capRatio;

  // Bands and pictures, cut clean at the poster's edge.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, heroW, heroBottom);
  ctx.clip();
  stripes(ctx, 0, 0, heroW, heroBottom, p);
  if (photos) {
    const x0 = !beside && wide ? w * 0.36 : 0;
    const span = heroW - x0;
    const centers = [x0 + span * 0.39, x0 + span * 0.73];
    const top = pad * 0.6;
    const blockTop = blockBottom - blockHeight(size);
    const namesRight = pad + Math.max(lineWidth(0, size), lineWidth(1, size));
    // Busts stand on a rule above the names; full-length pictures run behind them.
    const foot = busts ? blockTop - 26 * u : heroBottom;
    const room = foot - top;
    const sample = (g.f1.photo ?? g.f2.photo)!.image;
    const aspect = sample.width / sample.height;
    // Pictures grow with a tall poster, overlapping more, as the posters stand them.
    const target = clamp(room * aspect * 0.8, span * 0.5, span * 0.72);
    let height: number;
    let show = 1;
    if (busts) height = Math.min((target * 1.45) / aspect, room);
    else {
      // The chin sits about this far down a picture: it stays clear of the names that cross it.
      const CHIN = 0.37;
      const clearance = heroBottom - blockTop + 14 * u;
      height = target / aspect;
      if (namesRight > centers[0] - height * aspect * 0.2) {
        height = height > room ? Math.min(height, (room - clearance) / CHIN) : Math.min(room, Math.max(height, clearance / (1 - CHIN)));
      }
      // Never less than head and chest: a short poster takes smaller pictures instead.
      height = Math.min(height, room / 0.55);
      show = Math.min(1, room / height);
    }
    // The second corner first, so the first stands in front where they meet.
    for (const index of [1, 0]) {
      const photo = corners[index].photo;
      if (!photo) continue;
      const image = photo.image;
      const dh = height;
      const dw = (image.width / image.height) * dh;
      ctx.save();
      if (dimmed(g, index)) setBack(ctx);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, centers[index] - dw / 2, foot - dh * show, dw, dh);
      ctx.restore();
    }
    if (busts) {
      ctx.fillStyle = p.accent;
      ctx.fillRect(0, foot, heroW, Math.max(2, 4 * u));
    }
  }
  ctx.restore();
  if (badgeSize) badge(ctx, g.badge, pad, pad, badgeSize, p);

  const sup = supFor(size);
  let y = blockBottom - blockHeight(size) + cap;
  const drawName = (index: number, x: number, base: number) => {
    const c = corners[index];
    const room = nameRoom - (x - pad) - supWidth(index, size);
    ctx.textAlign = "left";
    ctx.fillStyle = p.ink;
    const used = fit(ctx, names[index], x, base, room, display, size, size * 0.8);
    ctx.font = display(used);
    let sx = x + Math.min(room, ctx.measureText(names[index]).width) + size * 0.08;
    // Rank, flag and pick ride at the top of the capitals, as the posters set them.
    const mid = base - cap + sup / 2;
    if (c.rank) sx += rankBox(ctx, c.rank, sx, mid, sup, p) + sup * 0.3;
    const drawn = flag(ctx, c.flag, sx, mid, sup * 1.2, "left");
    if (drawn) sx += drawn + sup * 0.3;
    if (g.pick?.side === sides[index]) mark(ctx, sx + sup / 2, mid, sup / 2, g.pick.state === "pending" ? p.accent : stateColor(p, g.pick.state), g.pick.state === "lost" ? "cross" : "check", g.pick.state === "pending" ? p.onAccent : "#ffffff");
  };
  drawName(0, pad, y);
  y += size * 0.14 + cap;
  ctx.font = display(size * 0.5);
  ctx.fillStyle = p.accent;
  slanted(ctx, "VS", pad, y);
  const vsW = ctx.measureText("VS").width;
  ctx.fillRect(pad, y + size * 0.06, vsW, Math.max(2, size * 0.04));
  drawName(1, pad + vsWidth(size), y);
  y += 30 * u + boutCap;
  ctx.font = boutFace;
  spacing(ctx, 2.4 * u);
  ctx.fillStyle = p.ink;
  const bout = upper(g.bout);
  slanted(ctx, bout, pad, y, "left", Math.min(nameRoom, ctx.measureText(bout).width));
  spacing(ctx, 0);
  for (const tag of tags) {
    const top = y + 20 * u;
    const mid = top + TAG / 2;
    const chipFace = text(800, 15 * u);
    ctx.font = chipFace;
    spacing(ctx, 1.6 * u);
    const chipW = Math.min(nameRoom * 0.6, ctx.measureText(tag.chip).width + 30 * u);
    roundRect(ctx, pad, top, chipW, TAG, 5 * u);
    ctx.fillStyle = tag.fill;
    ctx.fill();
    ctx.fillStyle = tag.ink;
    centered(ctx, tag.chip, pad + chipW / 2, mid, chipW - 20 * u);
    spacing(ctx, 0);
    if (tag.line) {
      const x = pad + chipW + 16 * u;
      const used = sizeFor(ctx, tag.line, nameRoom - chipW - 16 * u, (s) => text(700, s), 19 * u, 13 * u);
      ctx.font = text(700, used);
      ctx.fillStyle = p.ink;
      ctx.textAlign = "left";
      fit(ctx, tag.line, x, middle(ctx, tag.line, mid), nameRoom - chipW - 16 * u, (s) => text(700, s), used, used);
    }
    y = top + TAG;
  }

  if (panel) renderPanel();
  bar(ctx, w, h, u, pad, p, g.footer);

  // The figures: a head naming each corner, then the rows on the corners' axes.
  function renderPanel() {
    const top = beside ? 0 : heroBottom;
    const left = beside ? heroW : 0;
    ctx.fillStyle = p.raised;
    ctx.fillRect(left, top, w - left, floor - top);
    const x0 = left + pad;
    const x1 = w - pad;
    const colW = x1 - x0;
    const cx = (x0 + x1) / 2;
    const axes = [x0 + colW * 0.15, x1 - colW * 0.15];
    // Type shrinks less than the spacing around it.
    const type = Math.max(k, 0.8);
    let y = top + MARGIN + Math.max(0, floor - top - MARGIN * 2 - flex * k) / 2;

    const headFace = display(36 * u * type);
    const headCap = capHeight(ctx, headFace);
    corners.forEach((_corner, index) => {
      ctx.fillStyle = dimmed(g, index) ? p.faint : index ? p.f2 : p.f1;
      ctx.textAlign = "center";
      fit(ctx, names[index], axes[index], y + headCap, colW * 0.32, display, 36 * u * type, 20 * u);
      subs[index].forEach((line, row) => {
        ctx.fillStyle = p.muted;
        const face = text(600, sizeFor(ctx, line, colW * 0.34, (s) => text(600, s), 15 * u * type, 11 * u));
        label(ctx, line, axes[index], y + headCap + (30 + row * 28) * u * k, face, 1.2 * u, colW * 0.34);
      });
    });
    y += HEADER * k;

    for (const split of g.splits) {
      splitBar(ctx, split, x0, y + 12 * u * k, colW, 68 * u * k, p, u, [axes[0], axes[1]]);
      y += SPLIT * k;
    }

    const labelSize = 15 * u * type;
    const valueFace = text(700, 27 * u * type);
    ctx.font = valueFace;
    const widest = Math.max(0, ...entries.flatMap((entry) => "row" in entry && !entry.row.shared && !entry.row.form ? [ctx.measureText(entry.row.f1).width, ctx.measureText(entry.row.f2).width] : []));
    const labelW = Math.max(colW * 0.3, axes[1] - axes[0] - widest - 56 * u);
    entries.forEach((entry, index) => {
      if ("heading" in entry) {
        heading(ctx, entry.heading, x0, x1, y + HEAD * k * 0.56, u, p, 14 * u * type);
        y += HEAD * k;
        return;
      }
      const rowH = ROW * k;
      const mid = y + rowH / 2;
      const row = entry.row;
      if (index > 0 && !("heading" in entries[index - 1])) {
        ctx.fillStyle = p.line;
        ctx.fillRect(x0, y, colW, Math.max(1, 1.2 * u));
      }
      const name = upper(row.label);
      if (row.shared) {
        ctx.fillStyle = p.muted;
        ctx.textAlign = "left";
        ctx.font = text(600, labelSize);
        fit(ctx, name, x0, middle(ctx, name, mid), colW * 0.7, (s) => text(600, s), labelSize, 11 * u);
        ctx.fillStyle = p.ink;
        ctx.textAlign = "right";
        ctx.font = valueFace;
        fit(ctx, row.shared, x1, middle(ctx, row.shared, mid), colW * 0.26, (s) => text(700, s), 27 * u * type, 14 * u);
        y += rowH;
        return;
      }
      ctx.fillStyle = p.muted;
      ctx.font = text(600, labelSize);
      spacing(ctx, 1.6 * u);
      centered(ctx, name, cx, mid, labelW);
      spacing(ctx, 0);
      if (row.form) {
        const square = Math.min(26 * u * type, rowH * 0.62);
        formSquares(ctx, row.form.f1, axes[0], mid, square, p, "center");
        formSquares(ctx, row.form.f2, axes[1], mid, square, p, "center");
      } else {
        sides.forEach((side, i) => {
          ctx.font = valueFace;
          ctx.fillStyle = row.edge === side ? (i ? p.f2 : p.f1) : p.ink;
          centered(ctx, row[side], axes[i], mid, colW * 0.28);
        });
      }
      y += rowH;
    });

    if (judges.length) {
      heading(ctx, "Judges’ scorecards", x0, x1, y + 30 * u * k, u, p, 14 * u * type);
      const each = colW / judges.length;
      const scoreFace = display(46 * u * type);
      const scoreMid = y + 116 * u * k;
      judges.forEach((judge, index) => {
        const jx = x0 + each * index + each / 2;
        ctx.fillStyle = p.muted;
        ctx.font = text(600, 15 * u * type);
        spacing(ctx, 1.2 * u);
        centered(ctx, upper(judge.name), jx, y + 70 * u * k, each - 16 * u);
        spacing(ctx, 0);
        ctx.font = scoreFace;
        ctx.fillStyle = p.faint;
        centered(ctx, "–", jx, scoreMid);
        const base = middle(ctx, "0", scoreMid);
        ctx.textAlign = "right";
        ctx.fillStyle = judge.f1 > judge.f2 ? p.f1 : p.faint;
        ctx.fillText(String(judge.f1), jx - 18 * u, base);
        ctx.textAlign = "left";
        ctx.fillStyle = judge.f2 > judge.f1 ? p.f2 : p.faint;
        ctx.fillText(String(judge.f2), jx + 18 * u, base);
      });
    }
  }
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
  const pad = 56 * u;
  backdrop(ctx, w, h, p);
  const footTop = barTop(h, u);
  const bottom = footTop - 16 * u;
  const hasPhoto = Boolean(g.photo);
  const photoW = hasPhoto ? (format === "landscape" ? w * 0.36 : w * 0.42) : 0;
  if (g.photo) {
    stripes(ctx, 0, 0, pad + photoW + 10 * u, footTop, p);
    // Standing on the bar, cut clean at the column's edge.
    const columnW = pad + photoW + 10 * u;
    if (g.photo.kind === "full") cutout(ctx, g.photo.image, 0, pad, columnW, footTop - pad, "center", 0.92);
    else {
      // A bust fills the column's lower part, its shoulders cut at the column's edge.
      const image = g.photo.image;
      const scale = Math.min(((footTop - pad) * 0.62) / image.height, (columnW * 1.5) / image.width);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, columnW, footTop);
      ctx.clip();
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, columnW / 2 - (image.width * scale) / 2, footTop - image.height * scale, image.width * scale, image.height * scale);
      ctx.restore();
    }
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
  // The rank rides at the top of the capitals, as on the posters.
  const supFor = (size: number) => Math.max(20 * u, size * capRatio * 0.3);
  const rankRoom = (size: number) => g.rank ? rankWidth(ctx, g.rank, supFor(size)) + size * 0.08 : 0;
  const oneLine = sizeFor(ctx, words.join(" "), textW - rankRoom(110 * u), display, 120 * u, 56 * u);
  // Two lines when long, and a Jr. or III stays with the surname.
  const tail = words.length > 2 && /^(?:JR|SR)\.?$|^(?:II|III|IV)$/.test(words.at(-1)!) ? 2 : 1;
  const lines = oneLine < 90 * u && words.length > tail ? [words.slice(0, -tail).join(" "), words.slice(-tail).join(" ")] : [words.join(" ")];
  const size = lines.length > 1 ? Math.min(...lines.map((line) => sizeFor(ctx, line, textW - rankRoom(110 * u), display, 120 * u, 48 * u))) : oneLine;
  const cap = size * capRatio;
  for (const [index, line] of lines.entries()) {
    if (index) y += size * 0.16;
    y += cap;
    const last = index === lines.length - 1;
    const room = textW - (last ? rankRoom(size) : 0);
    ctx.fillStyle = p.ink;
    ctx.textAlign = "left";
    const used = fit(ctx, line, textX, y, room, display, size, size * 0.6);
    if (g.rank && last) {
      ctx.font = display(used);
      const sup = supFor(size);
      rankBox(ctx, g.rank, textX + Math.min(room, ctx.measureText(line).width) + size * 0.08, y - cap + sup / 2, sup, p);
    }
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
      fit(ctx, fact.value, fx, fy + 54 * u, colW - 12 * u, (s) => text(700, s), 34 * u, 20 * u);
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
        const face = text(800, 19 * u * Math.max(scale, 0.75));
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
      const valueSize = 30 * u * Math.max(scale, 0.75);
      ctx.font = text(700, valueSize);
      fit(ctx, stat.value, textX + textW, middle(ctx, stat.value, mid), textW * 0.33, (s) => text(700, s), valueSize, 18 * u);
      y += rowH;
    }
  }
  bar(ctx, w, h, u, pad, p, g.footer);
}

// ---------------------------------------------------------------------------
// A card

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
  const pad = 56 * u;
  backdrop(ctx, w, h, p);
  const footTop = barTop(h, u);
  stripes(ctx, 0, 0, w, barTop(h, u), p);
  const headBottom = cardHead(ctx, w, u, pad, p, g, format === "landscape");
  const top = headBottom + 30 * u;
  const bottom = footTop - 30 * u;
  // A long card in landscape runs in two columns rather than in small type.
  const split = format === "landscape" && g.rows.length > 5 ? Math.ceil(g.rows.length / 2) : g.rows.length;
  const gutter = 70 * u;
  if (split < g.rows.length) {
    boutList(ctx, g.rows.slice(0, split), true, pad, w / 2 - gutter / 2, top, bottom, u, p);
    boutList(ctx, g.rows.slice(split), false, w / 2 + gutter / 2, w - pad, top, bottom, u, p);
  } else boutList(ctx, g.rows, true, pad, w - pad, top, bottom, u, p);
  bar(ctx, w, h, u, pad, p, { ...g.footer, date: g.date });
}

/** Bouts one under another between `x0` and `x1`, names either side of a VS. */
function boutList(ctx: Ctx, rows: CardRow[], headed: boolean, x0: number, x1: number, top: number, bottom: number, u: number, p: Palette) {
  const width = x1 - x0;
  const splitCount = Math.max(0, ...rows.map((row) => row.splits.length));
  const hasSub = rows.some((row) => row.f1.sub || row.f2.sub || row.f1.odds || row.f2.odds || row.pick || row.result);
  const weightOf = (index: number) => (headed && index === 0 && rows.length > 2 ? 1.3 : 1);
  const startsGroup = (index: number) => Boolean(rows[index].group && rows[index].group !== rows[index - 1]?.group);
  const groups = rows.filter((_row, index) => startsGroup(index)).length;
  const total = rows.reduce((sum, _row, index) => sum + weightOf(index), 0) + groups * 0.45;
  // A row's height in units of its name size.
  const perSize = 0.3 + 0.36 + 0.78 + (hasSub ? 0.6 : 0) + splitCount * 1.05 + 0.5;
  const unit = Math.min((bottom - top) / Math.max(1, total), 70 * u * perSize);
  let y = top + Math.max(0, (bottom - top - unit * total) / 2);
  const capRatio = capHeight(ctx, display(100)) / 100 || 0.72;
  const mid = (x0 + x1) / 2;
  // What sits beside a name, outside it: the rank, then the flag.
  const extras = (c: CardSide, cap: number, s: number) => (c.rank ? rankWidth(ctx, c.rank, cap) + s * 0.2 : 0) + (flagWidth(ctx, c.flag, cap * 1.15) ? flagWidth(ctx, c.flag, cap * 1.15) + s * 0.2 : 0);
  // Every bout's names at one size, the main event's a step up: a long name
  // on one bout shrinks the rest with it rather than standing out.
  const sizes = rows.map((row, index) => {
    const s = (unit * weightOf(index)) / perSize;
    const cap = s * capRatio;
    const room = (side: "f1" | "f2") => width / 2 - s * 0.5 - extras(row[side], cap, s);
    return Math.min(sizeFor(ctx, upper(row.f1.name), room("f1"), display, s, s * 0.5), sizeFor(ctx, upper(row.f2.name), room("f2"), display, s, s * 0.5));
  });
  const undercard = Math.min(...sizes.filter((_size, index) => weightOf(index) === 1));
  rows.forEach((row, index) => {
    if (startsGroup(index)) {
      heading(ctx, row.group!, x0, x1, y + unit * 0.22, u, p, 15 * u);
      y += unit * 0.45;
    } else if (index > 0) {
      ctx.fillStyle = p.line;
      ctx.fillRect(x0 + width * 0.08, y, width * 0.84, Math.max(1, 1.2 * u));
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
    label(ctx, upper(row.meta), mid, metaY, metaFace, s * 0.05, width * 0.8);
    const nameY = metaY + s * 0.36 + cap;
    const nameMid = nameY - cap / 2;
    for (const side of ["f1", "f2"] as const) {
      const c = row[side];
      const left = side === "f1";
      const picked = row.pick?.side === side;
      const dim = (row.winner && row.winner !== side) || (row.pick && !picked);
      const space = width / 2 - gap - extras(c, cap, s);
      ctx.font = display(nameSize);
      const textW = Math.min(space, ctx.measureText(upper(c.name)).width);
      const anchor = left ? mid - gap : mid + gap;
      ctx.fillStyle = picked ? stateColor(p, row.pick!.state) : dim ? p.faint : p.ink;
      ctx.textAlign = left ? "right" : "left";
      fit(ctx, upper(c.name), anchor, nameY, space, display, nameSize, nameSize * 0.8);
      let edge = left ? anchor - textW - s * 0.2 : anchor + textW + s * 0.2;
      if (c.rank) {
        const rw = rankWidth(ctx, c.rank, cap);
        rankBox(ctx, c.rank, left ? edge - rw : edge, nameMid, cap, p);
        edge += left ? -rw - s * 0.2 : rw + s * 0.2;
      }
      flag(ctx, c.flag, edge, nameMid, cap * 1.15, left ? "right" : "left");
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
      splitBar(ctx, split, x0 + width * 0.06, barY, width * 0.88, s * 0.86, p, u);
      barY += s * 1.05;
    }
    y += rowH;
  });
}

function renderCardFaces(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: CardGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 56 * u;
  backdrop(ctx, w, h, p);
  const footTop = barTop(h, u);
  stripes(ctx, 0, 0, w, barTop(h, u), p);
  const headBottom = cardHead(ctx, w, u, pad, p, g, format === "landscape");
  const dateTop = footTop - 14 * u;
  const top = headBottom + 24 * u;
  const bottom = dateTop - 10 * u;
  const n = g.rows.length;
  const cols = format === "landscape" ? 4 : n <= 4 || (format === "story" && n <= 9) ? 2 : 3;
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
  const k = Math.max(0.5, Math.min(format === "story" ? 2 : 1.6, (bottom - top - fixed) / Math.max(1, natural)));
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
  bar(ctx, w, h, u, pad, p, { ...g.footer, date: g.date });
}

// ---------------------------------------------------------------------------
// A bet slip

function renderParlay(ctx: Ctx, w: number, h: number, format: Format, p: Palette, g: ParlayGraphic) {
  const u = Math.min(w, h) / 1000;
  const pad = 56 * u;
  backdrop(ctx, w, h, p);
  const footTop = barTop(h, u);
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
  bar(ctx, w, h, u, pad, p, g.footer);
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
