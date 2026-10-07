import { useApi, type Matchup, type TapeHistory as TapeHistoryData } from "../api";
import { CHART_TEXT, metaText, sectionLabel } from "./FightStats";

type Row = TapeHistoryData["rows"][number];

const RADIUS = 8;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** A full pie: f1's share in blue from twelve o'clock counter-clockwise,
 *  f2's in red filling the rest clockwise. Grey when there is no share. */
function Pie({ share, label }: { share: number | null; label: string }) {
  return (
    <svg viewBox="0 0 32 32" className="size-9 shrink-0" role="img" aria-label={label}>
      <circle cx="16" cy="16" r="16" fill={share == null ? "currentColor" : "var(--color-f2)"} className={share == null ? "text-zinc-200" : undefined} />
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

function HistoryRow({ row, minFights, names }: { row: Row; minFights: number; names: [string, string] }) {
  const enough = row.fights >= minFights;
  const share = enough ? row.f1Wins / row.fights : null;
  const f1Pct = share == null ? 0 : Math.round(share * 100);
  const sample = `${row.fights.toLocaleString()} ${row.fights === 1 ? "fight" : "fights"}${row.basis === "gap" ? ` with a ${row.gap}` : ""}`;
  const said = enough
    ? `${row.f1}: ${row.f1Wins} wins, ${row.f2}: ${row.f2Wins} wins, over ${sample}`
    : `Only ${sample}, too few to say`;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3" title={`${names[0]}: ${row.f1} · ${names[1]}: ${row.f2}. ${said}.`}>
      <Pie share={share} label={said} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`${sectionLabel} shrink-0`}>{row.label}</span>
          <span className={`truncate ${CHART_TEXT} text-zinc-500`}>{row.f1} vs {row.f2}</span>
        </div>
        <div className={`flex min-w-0 items-baseline gap-2 ${CHART_TEXT} tabular-nums`}>
          {enough ? <>
            <span className="font-semibold" style={{ color: "var(--color-f1-ink)" }}>{f1Pct}%</span>
            <span className="font-semibold" style={{ color: "var(--color-f2-ink)" }}>{100 - f1Pct}%</span>
            <span className="truncate text-zinc-400">{sample}</span>
          </> : <span className="truncate text-zinc-400">Only {sample}: too few to say</span>}
        </div>
      </div>
    </div>
  );
}

/** Advanced Tale of the tape: for each row on which the two differ, how often
 *  that side of the difference won in decided UFC bouts before this one. */
export default function TapeHistory({ fight }: { fight: Matchup }) {
  const { data, error, retry } = useApi<TapeHistoryData>(`/api/fights/${fight.id}/tape-history`);
  const names: [string, string] = [fight.f1.name, fight.f2.name];
  return (
    <div className="tape-history min-w-0" aria-label="How these differences have gone before">
      <h3 className="sr-only">How these differences have gone before</h3>
      {data ? data.rows.map(row => <HistoryRow key={row.key} row={row} minFights={data.minFights} names={names} />)
        : error ? <p className={`${CHART_TEXT} text-zinc-400`}>Could not load. <button type="button" onClick={retry} className="underline">Retry</button></p>
          : <p className={`${CHART_TEXT} text-zinc-400`}>Loading earlier bouts…</p>}
      {data && !data.rows.length ? <p className={`${CHART_TEXT} text-zinc-400`}>Nothing on the tape sets these two apart.</p> : null}
      {data ? (
        <p className={`${metaText} pt-2 leading-4`}>
          Win rate of a fighter with each value against one with the other, in decided UFC bouts before
          this one, measured as they stood that night. Draws and no contests are left out.
        </p>
      ) : null}
    </div>
  );
}
