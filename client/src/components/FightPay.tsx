import type { FightPay as Pay, FightPaySide, Matchup } from "../api";
import { lastName } from "../format";
import { CHART_TEXT, CompareRow, PANEL_SHELL, PanelHeading, compareLabel, metaText } from "./FightStats";

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const LINK = "underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

function Source({ label, url }: { label: string; url: string }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className={LINK}>{label}&nbsp;↗</a>;
}

/** A value with a quieter line under it, aligned to its corner. */
function Value({ main, meta, muted, align }: { main: string; meta?: string | null; muted?: boolean; align: "left" | "right" }) {
  return (
    <div className={`min-w-0 ${align === "right" ? "text-right" : "text-left"}`}>
      <div className={`truncate ${CHART_TEXT} font-semibold tabular-nums ${muted ? "font-medium text-zinc-400" : "text-zinc-900"}`}>{main}</div>
      {meta ? <div className={`${metaText} leading-3`}>{meta}</div> : null}
    </div>
  );
}

function purseValue(side: FightPaySide, read: boolean): { main: string; meta?: string | null; muted?: boolean } {
  const purse = side.purse;
  if (!purse) return { main: read ? "Not disclosed" : "Not read yet", muted: true };
  const parts = purse.show != null && purse.win ? `${usd(purse.show)} show + ${usd(purse.win)} win`
    : purse.win ? `incl. ${usd(purse.win)} win bonus`
    : purse.win === 0 ? "no win bonus" : null;
  return { main: usd(purse.total), meta: [parts, purse.also].filter(Boolean).join(" · ") || null };
}

function bonusValue(side: FightPaySide): { main: string; meta?: string | null; muted?: boolean } {
  if (!side.bonuses.length) return { main: "—", muted: true };
  const known = side.bonuses.filter((bonus) => bonus.amount != null);
  const total = known.reduce((sum, bonus) => sum + bonus.amount!, 0);
  const unknown = side.bonuses.length - known.length;
  return {
    main: !known.length ? "Amount unknown" : unknown ? `${usd(total)} + unknown` : usd(total),
    meta: side.bonuses.map((bonus) => bonus.label).join(", "),
    muted: !known.length,
  };
}

function complianceValue(side: FightPaySide): { main: string; meta?: string | null; muted?: boolean } {
  if (side.compliance) return { main: `≈ ${usd(side.compliance.amount)}`, meta: "Estimate" };
  return side.compliance_gap ? { main: "Not estimated", meta: side.compliance_gap, muted: true } : { main: "—", muted: true };
}

/** Purse and bonuses as reported; the estimate never counts toward it. */
function reportedTotal(side: FightPaySide): number | null {
  if (!side.purse) return null;
  return side.purse.total + side.bonuses.reduce((sum, bonus) => sum + (bonus.amount ?? 0), 0);
}

function inputs(name: string, side: FightPaySide): string {
  const c = side.compliance;
  if (!c) return `${name}: not estimated (${side.compliance_gap?.toLowerCase() ?? "no bout count"}).`;
  const counted = [`${c.ufc} UFC`, c.wec ? `${c.wec} WEC` : "", c.strikeforce ? `${c.strikeforce} Strikeforce` : ""].filter(Boolean).join(", ");
  const tier = c.role ? `${c.tier.toLowerCase()} pay` : `the ${c.tier} tier`;
  return `${name}: ${ordinal(c.bouts)} bout (${counted}), ${tier}, ${usd(c.amount)}.`;
}

/** What each fighter was paid for the bout, as far as anyone published it:
 *  the purse a commission disclosed, post-fight bonuses, and an estimate of
 *  fight-week pay, kept apart so a reader can tell reported from estimated. */
export default function FightPay({ fight }: { fight: Matchup }) {
  const pay: Pay | null | undefined = fight.pay;
  if (!pay) return null;
  const sides = [pay.f1, pay.f2] as const;
  const names = [lastName(fight.f1.name), lastName(fight.f2.name)];
  const anyPurse = sides.some((side) => side.purse);
  const anyBonus = sides.some((side) => side.bonuses.length);
  const anyCompliance = sides.some((side) => side.compliance || side.compliance_gap);
  const row = (label: string, value: (side: FightPaySide) => { main: string; meta?: string | null; muted?: boolean }) => (
    <CompareRow
      center={<span className={`${compareLabel} whitespace-normal`}>{label}</span>}
      f1={<Value align="right" {...value(pay.f1)} />}
      f2={<Value align="left" {...value(pay.f2)} />}
    />
  );
  const commissions = [...new Set(pay.purse_sources.map((source) => source.commission).filter(Boolean))];
  const notes = sides.flatMap((side, i) => [
    ...(side.purse?.note ? [`${names[i]}: ${side.purse.note}`] : []),
    ...side.bonuses.filter((bonus) => bonus.note).map((bonus) => `${names[i]} (${bonus.label}): ${bonus.note}`),
  ]);
  return (
    <section className={`${PANEL_SHELL} overflow-hidden`}>
      <PanelHeading title="Pay" subtitle={commissions.length ? `Disclosed by the ${commissions.join(" and ")}` : undefined} />
      <div className="px-5 pb-1 pt-1">
        {row("Purse", (side) => purseValue(side, pay.read))}
        {anyBonus ? row("Bonus", bonusValue) : null}
        {anyCompliance ? row("Fight week", complianceValue) : null}
        {anyPurse && anyBonus ? row("Reported", (side) => {
          const total = reportedTotal(side);
          return total == null ? { main: "—", muted: true } : { main: usd(total), meta: "purse + bonuses" };
        }) : null}
      </div>
      <div className={`space-y-1.5 border-t border-zinc-100 px-5 py-3 ${CHART_TEXT} leading-4 text-zinc-500`}>
        {anyPurse ? (
          <p>
            A disclosed purse is the show money and win bonus filed with the {commissions.length ? commissions.join(" and ") : "athletic commission"}. It leaves out pay-per-view
            shares, sponsorships and discretionary bonuses, so total earnings are higher. Source:{" "}
            {pay.purse_sources.map((source, i) => (
              <span key={source.url}>
                {i ? ", " : ""}<Source label={source.label} url={source.url} />
                {source.cited ? <> (citing <Source label={source.cited.label} url={source.cited.url} />)</> : null}
              </span>
            ))}.
          </p>
        ) : (
          <p>{pay.read ? "No commission disclosed the purses for this bout, so they are unknown." : "This card's pay sources haven't been read yet."}</p>
        )}
        {anyBonus && pay.bonus_source ? (
          <p>
            Bonuses: <Source label={pay.bonus_source.label} url={pay.bonus_source.url} />
            {pay.bonus_source.cited ? <> (citing <Source label={pay.bonus_source.cited.label} url={pay.bonus_source.cited.url} />)</> : null}.
          </p>
        ) : null}
        {notes.map((note) => <p key={note}>{note}</p>)}
        {anyCompliance ? (
          <details>
            <summary className="cursor-pointer select-none hover:text-zinc-900 dark:hover:text-zinc-100">How fight-week pay is estimated</summary>
            <div className="mt-1.5 space-y-1">
              <p>
                UFC pays every fighter for fight-week obligations by tier: $4,000 for 1–3 bouts, $4,500 for 4–5, $6,000 for 6–10,
                $11,000 for 11–15, $16,000 for 16–20 and $21,000 for 21 or more; $32,000 for a title challenger and $42,000 for the
                champion. Bouts count UFC fights, this one included, and WEC and Strikeforce fights under Zuffa. This is the Venum-era
                schedule, in force since April 2021; a fighter's actual figure can be a tier off.
                {pay.compliance_source ? <> <Source label={pay.compliance_source.label} url={pay.compliance_source.url} /></> : null}
              </p>
              {sides.map((side, i) => <p key={i}>{inputs(i ? fight.f2.name : fight.f1.name, side)}</p>)}
            </div>
          </details>
        ) : null}
      </div>
    </section>
  );
}
