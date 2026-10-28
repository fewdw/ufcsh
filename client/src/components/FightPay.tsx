import { CircleHelp, X } from "lucide-react";
import { useRef, useState } from "react";
import type { FightPay as Pay, FightPaySide, Matchup } from "../api";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { CHART_TEXT, PANEL_SHELL, PanelHeading, compareLabel } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "./segmented";

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
const short = (value: number) => value >= 1_000 && value % 1_000 === 0 ? `$${(value / 1_000).toLocaleString("en-US")}K` : usd(value);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const LINK = "underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

type Category = "purse" | "bonus" | "week" | "total";
const LABELS: Record<Category, string> = { purse: "Purse", bonus: "Bonus", week: "Fight week", total: "Total" };
type Cell = { value: string; detail?: string | null; muted?: boolean };

function Source({ label, url }: { label: string; url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>{label}&nbsp;↗</a>;
}
type Cited = { label: string; url: string; cited: { label: string; url: string } | null; archive?: { label: string; url: string } };
const cited = (source: Cited) => <><Source label={source.label} url={source.url} />{source.cited ? <> (citing <Source label={source.cited.label} url={source.cited.url} />)</> : null}{source.archive ? <> · <Source label={source.archive.label} url={source.archive.url} /></> : null}</>;

/** One line: f1's value | the label and its ? | f2's value. */
function Row({ label, f1, f2, onInfo }: { label: string; f1: Cell; f2: Cell; onInfo: () => void }) {
  const cell = (c: Cell, side: "f1" | "f2") => (
    <div className={`flex min-w-0 flex-wrap items-baseline gap-x-1.5 ${side === "f1" ? "flex-row-reverse justify-start" : ""}`}>
      <span className={`${CHART_TEXT} font-semibold tabular-nums ${c.muted ? "font-medium text-zinc-400" : "text-zinc-900"}`}>{c.value}</span>
      {c.detail ? <span className="text-[10px] tabular-nums text-zinc-400">{c.detail}</span> : null}
    </div>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)] items-center gap-3 py-1 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)]">
      {cell(f1, "f1")}
      <button type="button" onClick={onInfo} aria-haspopup="dialog" aria-label={`What ${label.toLowerCase()} means`}
        className="group flex items-center justify-center gap-1 rounded text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100">
        <span className={`${compareLabel} whitespace-normal group-hover:text-current`}>{label}</span>
        <CircleHelp className="h-3 w-3 shrink-0" aria-hidden="true" />
      </button>
      {cell(f2, "f2")}
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

const weekCell = (side: FightPaySide): Cell => side.compliance ? { value: `~${usd(side.compliance.amount)}` } : { value: "Unknown", muted: true };

/** The disclosed purse and bonuses: what is known, never all of it. */
function totalCell(side: FightPaySide): Cell {
  if (!side.purse) return { value: "Unknown", muted: true };
  return { value: `${usd(side.purse.total + side.bonuses.reduce((sum, bonus) => sum + (bonus.amount ?? 0), 0))}+` };
}

function purseLine(name: string, side: FightPaySide, read: boolean): string {
  const purse = side.purse;
  if (!purse) return `${name}: ${read ? "undisclosed" : "unknown, this card's sources haven't been read yet"}.`;
  const parts = purse.show != null && purse.win ? `, ${usd(purse.show)} to show and ${usd(purse.win)} to win`
    : purse.win ? `, including a ${usd(purse.win)} win bonus` : purse.win === 0 ? ", no win bonus" : "";
  return `${name}: ${usd(purse.total)}${parts}.${purse.note ? ` ${purse.note}` : ""}${purse.also ? ` ${purse.also}.` : ""}`;
}

function weekLine(name: string, side: FightPaySide): string {
  const c = side.compliance;
  if (!c) return `${name}: unknown${side.compliance_gap ? ` (${side.compliance_gap.toLowerCase()})` : ""}.`;
  const counted = [`${c.ufc} UFC`, c.wec ? `${c.wec} WEC` : "", c.strikeforce ? `${c.strikeforce} Strikeforce` : ""].filter(Boolean).join(", ");
  return `${name}: ${c.role ? c.tier.toLowerCase() : `${ordinal(c.bouts)} bout (${counted}), ${c.tier}`}, ~${usd(c.amount)}.`;
}

/** Every category explained, on tabs, opened at the one asked about: the
 *  general rule first, then what this bout's sources say. */
function PayDialog({ fight, pay, names, start, close }: { fight: Matchup; pay: Pay; names: [string, string]; start: Category; close: () => void }) {
  const [tab, setTab] = useState<Category>(start);
  const refs = useRef(new Map<Category, HTMLButtonElement>());
  const tabs: Category[] = ["purse", "bonus", "week", "total"];
  const id = `pay-${fight.id}`;
  const sides = [pay.f1, pay.f2] as const;
  const commissions = [...new Set(pay.purse_sources.map((source) => source.commission).filter(Boolean))];
  const move = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next == null) return;
    event.preventDefault();
    const target = tabs[(next + tabs.length) % tabs.length];
    setTab(target);
    refs.current.get(target)?.focus();
  };
  const general: Record<Category, React.ReactNode> = {
    purse: <>
      <p>What the promotion filed with the athletic commission for this bout: show money for competing, and a win bonus if the fighter won. A weight-miss fine paid to the opponent can be inside it.</p>
      <p>Only some commissions make purses public. <strong>Undisclosed</strong> means no supported public figure was found in our sources for this bout; nothing is guessed.</p>
    </>,
    bonus: <>
      <p>Bonuses UFC awards after the card: Fight of the Night to both fighters, Performance of the Night (before 2014, Knockout and Submission of the Night), and from 2026 a smaller bonus for other knockouts and submissions.</p>
      <p><strong>Unknown</strong> means the bonus was awarded but its amount isn't stated, or it was forfeited or handed to the opponent. Fan-voted and sponsor bonuses are left out.</p>
    </>,
    week: <>
      <p><strong>An estimate</strong> (~). UFC pays every fighter for fight-week obligations (the uniform and media) by tier: $4,000 for 1–3 bouts, $4,500 for 4–5, $6,000 for 6–10, $11,000 for 11–15, $16,000 for 16–20 and $21,000 for 21 or more; $32,000 for a title challenger, $42,000 for the champion.</p>
      <p>Bouts are UFC fights, this one included, plus WEC and Strikeforce fights under Zuffa. This schedule began in April 2021; earlier bouts aren't estimated, and the real figure can be a tier off. {pay.compliance_source ? <Source label={pay.compliance_source.label} url={pay.compliance_source.url} /> : null}</p>
    </>,
    total: <p>The disclosed purse plus known bonuses, marked + as a partial sum. Fight-week pay, pay-per-view shares, sponsorships and discretionary bonuses aren't counted. This is not total earnings or take-home pay after taxes and expenses. Shown only when the purse was disclosed.</p>,
  };
  const specific: Record<Category, React.ReactNode> = {
    purse: <>
      {sides.map((side, i) => <p key={i}>{purseLine(names[i], side, pay.read)}</p>)}
      {pay.purse_sources.length ? <p>{commissions.length ? `Disclosed by the ${commissions.join(" and ")}. ` : ""}Source: {pay.purse_sources.map((source, i) => <span key={source.url}>{i ? ", " : ""}{cited(source)}</span>)}.</p> : null}
    </>,
    bonus: <>
      {sides.map((side, i) => side.bonuses.length
        ? side.bonuses.map((bonus) => <p key={`${i}${bonus.label}`}>{names[i]}: {bonus.label}, {bonus.amount != null ? usd(bonus.amount) : "amount unknown"}.{bonus.note ? ` ${bonus.note}` : ""}</p>)
        : <p key={i}>{names[i]}: {pay.bonus_source ? "none" : "none recorded"}.</p>)}
      {pay.bonus_source ? <p>Source: {cited(pay.bonus_source)}.</p> : null}
    </>,
    week: <>{sides.map((side, i) => <p key={i}>{side.compliance || side.compliance_gap ? weekLine(names[i], side) : `${names[i]}: not estimated, before April 2021.`}</p>)}</>,
    total: <>{sides.map((side, i) => <p key={i}>{names[i]}: {side.purse ? totalCell(side).value : "unknown, the purse is undisclosed"}.</p>)}</>,
  };
  return (
    <EvidenceDialog id={id} close={close}>
      <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Pay</h2>
          <button type="button" aria-label="Close pay" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
        </div>
        <div role="tablist" aria-label="Pay categories" className={`${segmentedGroup} mt-3 w-full`}>
          {tabs.map((category, index) => (
            <button key={category} type="button" role="tab" id={`${id}-tab-${category}`} aria-selected={category === tab} aria-controls={`${id}-panel`}
              ref={(node) => { if (node) refs.current.set(category, node); else refs.current.delete(category); }}
              tabIndex={category === tab ? 0 : -1} onClick={() => setTab(category)} onKeyDown={(event) => move(event, index)}
              className={`${segmentedTab} ${category === tab ? segmentedSelected : segmentedIdle}`}>
              {LABELS[category]}
            </button>
          ))}
        </div>
      </div>
      <div data-sheet-scroll id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} tabIndex={0}
        className="min-h-0 flex-1 space-y-4 overflow-auto overscroll-y-none px-4 pb-5 text-sm leading-6 text-zinc-600 sm:px-5">
        <div className="space-y-2">{general[tab]}</div>
        <section className="space-y-1 border-t border-zinc-100 pt-3">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-400">This bout</h3>
          {specific[tab]}
        </section>
      </div>
    </EvidenceDialog>
  );
}

/** What each fighter was paid for the bout, as far as anyone published it:
 *  the purse a commission disclosed, post-fight bonuses, and an estimate of
 *  fight-week pay. Undisclosed is said plainly; an estimate wears a ~. */
export default function FightPay({ fight }: { fight: Matchup }) {
  const [info, setInfo] = useState<Category | null>(null);
  const pay: Pay | null | undefined = fight.pay;
  if (!pay) return null;
  const sides = [pay.f1, pay.f2] as const;
  const names: [string, string] = [fight.f1.name, fight.f2.name];
  const anyPurse = sides.some((side) => side.purse);
  const anyBonus = sides.some((side) => side.bonuses.length);
  const anyCompliance = sides.some((side) => side.compliance || side.compliance_gap);
  const commissions = [...new Set(pay.purse_sources.map((source) => source.commission).filter(Boolean))];
  const row = (category: Category, cell: (side: FightPaySide) => Cell) =>
    <Row label={LABELS[category]} f1={cell(pay.f1)} f2={cell(pay.f2)} onInfo={() => setInfo(category)} />;
  return (
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="Pay" subtitle={commissions.length ? `Disclosed by the ${commissions.join(" and ")}` : pay.read ? "Purses undisclosed" : undefined} />
      <div className="px-4 py-1.5 sm:px-5">
        {row("purse", (side) => purseCell(side, pay.read))}
        {anyBonus ? row("bonus", bonusCell) : null}
        {anyCompliance ? row("week", weekCell) : null}
        {anyPurse && anyBonus ? row("total", totalCell) : null}
      </div>
      {info ? <PayDialog fight={fight} pay={pay} names={names} start={info} close={() => setInfo(null)} /> : null}
    </section>
  );
}
