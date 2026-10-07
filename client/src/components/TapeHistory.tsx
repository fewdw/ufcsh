import { useEffect, useRef, useState } from "react";
import { useApi, type Matchup, type TapeHistory as TapeHistoryData } from "../api";
import { CHART_TEXT, metaText, sectionLabel } from "./FightStats";

type Row = TapeHistoryData["rows"][number];

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A full pie: f1's share in blue from twelve o'clock counter-clockwise,
 *  f2's in red filling the rest clockwise. */
function Pie({ share, label }: { share: number; label: string }) {
  return (
    <svg viewBox="0 0 32 32" className="size-12 shrink-0 @[26rem]:size-10" role="img" aria-label={label}>
      <circle cx="16" cy="16" r="16" fill="var(--color-f2)" />
      {share ? (
        <circle
          cx="16" cy="16" r={RADIUS} fill="none" stroke="var(--color-f1)" strokeWidth={RADIUS * 2}
          strokeDasharray={`${share * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
          transform="translate(32 0) scale(-1 1) rotate(-90 16 16)"
        />
      ) : null}
    </svg>
  );
}

/** One difference in a tile, mirrored like the tape: f1's share and value on
 *  the left, f2's on the right, the larger share in bold. Three to a row
 *  beside the tape, where the values share one line under the pie. */
function HistoryTile({ row, names }: { row: Row; names: [string, string] }) {
  const share = row.f1Wins / row.fights;
  const f1Pct = Math.round(share * 100);
  const f2Pct = 100 - f1Pct;
  const sample = `${row.fights.toLocaleString()} fights`;
  const said = `${row.f1}: ${row.f1Wins} wins, ${row.f2}: ${row.f2Wins} wins, over ${sample}${row.gap ? ` with a ${row.gap}` : ""}`;
  const pct = (value: number, other: number, ink: string) => (
    <span className={`text-sm tabular-nums ${value > other ? "font-bold" : "font-medium opacity-70"}`} style={{ color: ink }}>{value}%</span>
  );
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 py-1 @[26rem]:gap-1 @[26rem]:py-0" title={`${names[0]}: ${row.f1} · ${names[1]}: ${row.f2}. ${said}.`}>
      <span className={sectionLabel}>{row.label}</span>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-2 @[26rem]:gap-x-1.5">
        <div className="flex min-w-0 flex-col items-end text-right">
          {pct(f1Pct, f2Pct, "var(--color-f1-ink)")}
          <span className={`${CHART_TEXT} leading-tight text-zinc-600 @[26rem]:hidden`}>{row.f1}</span>
        </div>
        <Pie share={share} label={said} />
        <div className="flex min-w-0 flex-col items-start">
          {pct(f2Pct, f1Pct, "var(--color-f2-ink)")}
          <span className={`${CHART_TEXT} leading-tight text-zinc-600 @[26rem]:hidden`}>{row.f2}</span>
        </div>
      </div>
      <span className={`hidden text-center ${CHART_TEXT} leading-tight @[26rem]:block`}>
        <span style={{ color: "var(--color-f1-ink)" }}>{row.f1}</span>
        <span className="text-zinc-400"> vs </span>
        <span style={{ color: "var(--color-f2-ink)" }}>{row.f2}</span>
      </span>
      <span className={`${metaText} text-center`}>{row.gap ? `${row.gap} · ${sample}` : sample}</span>
    </div>
  );
}

/** Advanced Tale of the tape: for each row on which the two differ, how often
 *  that side of the difference won in decided UFC bouts before this one, the
 *  most one-sided first. Rows without enough earlier bouts to say are not sent. */
export default function TapeHistory({ fight }: { fight: Matchup }) {
  // Ask only once the pies are on screen: a hidden copy (a phone with the wide
  // screen's saved setting) never intersects, so it never costs a request.
  const root = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const element = root.current;
    if (!element || shown) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setShown(true);
    }, { rootMargin: "400px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);
  const { data, error, retry } = useApi<TapeHistoryData>(shown ? `/api/fights/${fight.id}/tape-history` : null);
  const names: [string, string] = [fight.f1.name, fight.f2.name];
  if (data && !data.rows.length) return null;
  return (
    <div ref={root} className="@container h-full min-w-0" aria-label="How these differences have gone before">
      <h3 className="sr-only">How these differences have gone before</h3>
      {data ? (
        <div className="grid h-full grid-cols-1 content-start gap-x-2 gap-y-5 @[18rem]:grid-cols-2 @[26rem]:grid-cols-3 @[26rem]:content-evenly @[26rem]:gap-y-2.5">
          {data.rows.map((row) => ({ row, edge: Math.abs(row.f1Wins / row.fights - 0.5) }))
            .sort((a, b) => b.edge - a.edge)
            .map(({ row }) => <HistoryTile key={row.key} row={row} names={names} />)}
        </div>
      ) : error ? <p className={`${CHART_TEXT} text-zinc-400`}>Could not load. <button type="button" onClick={retry} className="underline">Retry</button></p>
        : <p className={`${CHART_TEXT} text-zinc-400`}>Loading earlier bouts…</p>}
    </div>
  );
}
