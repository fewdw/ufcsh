import { CircleHelp } from "lucide-react";
import { useState } from "react";
import type { FightPay as Pay, FightPaySide, Matchup } from "../api";
import { lastName } from "../format";
import { CHART_TEXT, PANEL_SHELL, PanelHeading, compareLabel } from "./FightStats";

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
const short = (value: number) => value >= 1_000 && value % 1_000 === 0 ? `$${(value / 1_000).toLocaleString("en-US")}K` : usd(value);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const LINK = "underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

function Source({ label, url }: { label: string; url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>{label}&nbsp;↗</a>;
}

type Cell = { value: string; detail?: string | null; muted?: boolean };

/** One line: f1's value | the label (and its ?) | f2's value. The ? opens the
 *  row's sources and notes under it; a row with nothing to add has none. */
function Row({ label, f1, f2, info }: { label: string; f1: Cell; f2: Cell; info?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const cell = (c: Cell, side: "f1" | "f2") => (
    <div className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 ${side === "f1" ? "flex-row-reverse justify-start" : ""}`}>
      <span className={`${CHART_TEXT} font-semibold tabular-nums ${c.muted ? "font-medium text-zinc-400" : "text-zinc-900"}`}>{c.value}</span>
      {c.detail ? <span className="text-[10px] tabular-nums text-zinc-400">{c.detail}</span> : null}
    </div>
  );
  return (
    <div>
      <div className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] items-center gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
        {cell(f1, "f1")}
        <div className="flex items-center justify-center gap-1">
          <span className={`${compareLabel} whitespace-normal`}>{label}</span>
          {info ? (
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`About ${label.toLowerCase()}`}
              className="-m-1 rounded p-1 text-zinc-400 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">
              <CircleHelp className="h-3 w-3" aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {cell(f2, "f2")}
      </div>
      {open && info ? <div className={`mb-1.5 space-y-1 rounded-md bg-zinc-50 px-3 py-2 ${CHART_TEXT} leading-4 text-zinc-600`}>{info}</div> : null}
    </div>
  );
}

function purseCell(side: FightPaySide, read: boolean): Cell {
  const purse = side.purse;
  if (!purse) return { value: read ? "Undisclosed" : "Unknown", muted: true };
  const detail = purse.show != null && purse.win ? `${short(purse.show)} + ${short(purse.win)} win`
    : purse.win ? `incl. ${short(purse.win)} win` : purse.win === 0 ? "no win bonus" : null;
  return { value: usd(purse.total), detail };
}

function bonusCell(side: FightPaySide): Cell {
  if (!side.bonuses.length) return { value: "None", muted: true };
  const known = side.bonuses.filter((bonus) => bonus.amount != null);
  if (!known.length) return { value: "Unknown", muted: true };
  const total = usd(known.reduce((sum, bonus) => sum + bonus.amount!, 0));
  return { value: known.length < side.bonuses.length ? `${total} + unknown` : total };
}

/** The disclosed purse and bonuses: what is known, never all of it. */
function totalCell(side: FightPaySide): Cell {
  if (!side.purse) return { value: "Unknown", muted: true };
  return { value: `${usd(side.purse.total + side.bonuses.reduce((sum, bonus) => sum + (bonus.amount ?? 0), 0))}+` };
}

function estimateLine(name: string, side: FightPaySide): string {
  const c = side.compliance;
  if (!c) return `${name}: unknown${side.compliance_gap ? ` (${side.compliance_gap.toLowerCase()})` : ""}.`;
  const counted = [`${c.ufc} UFC`, c.wec ? `${c.wec} WEC` : "", c.strikeforce ? `${c.strikeforce} Strikeforce` : ""].filter(Boolean).join(", ");
  return `${name}: ${c.role ? c.tier.toLowerCase() : `${ordinal(c.bouts)} bout (${counted})`}, ~${usd(c.amount)}.`;
}

/** What each fighter was paid for the bout, as far as anyone published it:
 *  the purse a commission disclosed, post-fight bonuses, and an estimate of
 *  fight-week pay. Undisclosed is said plainly; an estimate wears a ~. */
export default function FightPay({ fight }: { fight: Matchup }) {
  const pay: Pay | null | undefined = fight.pay;
  if (!pay) return null;
  const sides = [pay.f1, pay.f2] as const;
  const names = [lastName(fight.f1.name), lastName(fight.f2.name)];
  const anyPurse = sides.some((side) => side.purse);
  const anyBonus = sides.some((side) => side.bonuses.length);
  const anyCompliance = sides.some((side) => side.compliance || side.compliance_gap);
  const commissions = [...new Set(pay.purse_sources.map((source) => source.commission).filter(Boolean))];
  const cited = (source: { label: string; url: string; cited: { label: string; url: string } | null }) => (
    <><Source label={source.label} url={source.url} />{source.cited ? <> (citing <Source label={source.cited.label} url={source.cited.url} />)</> : null}</>
  );

  const purseNotes = sides.flatMap((side, i) => [side.purse?.note, side.purse?.also].filter(Boolean).map((note) => `${names[i]}: ${note}`));
  const purseInfo = anyPurse ? <>
    <p>
      Show money and win bonus as filed with the {commissions.length ? commissions.join(" and ") : "athletic commission"}.
      Source: {pay.purse_sources.map((source, i) => <span key={source.url}>{i ? ", " : ""}{cited(source)}</span>)}.
    </p>
    {purseNotes.map((note) => <p key={note}>{note}</p>)}
  </> : null;

  const bonusInfo = anyBonus ? <>
    {sides.flatMap((side, i) => side.bonuses.map((bonus) => (
      <p key={`${i}${bonus.label}`}>{names[i]}: {bonus.label}, {bonus.amount != null ? usd(bonus.amount) : "amount unknown"}{bonus.note ? `. ${bonus.note}` : ""}</p>
    )))}
    {pay.bonus_source ? <p>Source: {cited(pay.bonus_source)}.</p> : null}
  </> : null;

  const complianceInfo = anyCompliance ? <>
    <p>
      Estimate. UFC pays every fighter for fight week by tier: $4,000 for 1–3 bouts, $4,500 for 4–5, $6,000 for 6–10, $11,000 for 11–15,
      $16,000 for 16–20, $21,000 for 21+; $32,000 for a title challenger, $42,000 for the champion. Bouts are UFC fights, this one included,
      plus WEC and Strikeforce fights under Zuffa. Venum-era schedule, since April 2021; the real figure can be a tier off.
      {pay.compliance_source ? <> <Source label="ESPN" url={pay.compliance_source.url} /></> : null}
    </p>
    {sides.map((side, i) => <p key={i}>{estimateLine(names[i], side)}</p>)}
  </> : null;

  return (
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="Pay" subtitle={commissions.length ? `Disclosed by the ${commissions.join(" and ")}` : pay.read ? "Purses undisclosed" : undefined} />
      <div className="px-4 py-1.5 sm:px-5">
        <Row label="Purse" f1={purseCell(pay.f1, pay.read)} f2={purseCell(pay.f2, pay.read)} info={purseInfo} />
        {anyBonus ? <Row label="Bonus" f1={bonusCell(pay.f1)} f2={bonusCell(pay.f2)} info={bonusInfo} /> : null}
        {anyCompliance ? (
          <Row label="Fight week"
            f1={pay.f1.compliance ? { value: `~${usd(pay.f1.compliance.amount)}` } : { value: "Unknown", muted: true }}
            f2={pay.f2.compliance ? { value: `~${usd(pay.f2.compliance.amount)}` } : { value: "Unknown", muted: true }}
            info={complianceInfo} />
        ) : null}
        {anyPurse && anyBonus ? (
          <Row label="Total" f1={totalCell(pay.f1)} f2={totalCell(pay.f2)} info={
            <p>Disclosed purse plus bonuses. Fight-week pay, pay-per-view shares, sponsorships and discretionary bonuses aren't counted, so real earnings are higher.</p>
          } />
        ) : null}
      </div>
    </section>
  );
}
