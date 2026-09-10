import { ArrowLeft, ArrowRight } from "lucide-react";
import { oddsMovement, type OddsMovement } from "../oddsMovement";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { Tooltip } from "./Tooltip";

function Movement({ movement, name }: { movement: OddsMovement; name: string }) {
  const { at, id, open, handlers } = useTooltip();
  const label = `Money moved ${movement.points} points toward ${lastName(name)}`;
  const Arrow = movement.toward === "f1" ? ArrowLeft : ArrowRight;
  return (
    <span
      className="flex flex-col items-center justify-center gap-0.5 rounded text-zinc-500"
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? id : undefined}
      {...handlers}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) event.stopPropagation();
        handlers.onKeyDown(event);
      }}
    >
      <Arrow className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      <span className="text-[9px] font-medium leading-3 tabular-nums">{movement.points}</span>
      <Tooltip id={id} at={at}>{label}</Tooltip>
    </span>
  );
}

export default function MatchupOdds({ f1, f2, f1Open, f2Open, f1Name, f2Name }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Open?: string | null;
  f2Open?: string | null;
  f1Name: string;
  f2Name: string;
}) {
  if (!f1 && !f2) return null;
  const movement = oddsMovement(f1Open, f1, f2Open, f2);
  const hasOpen = Boolean(f1Open || f2Open);
  return (
    <div className="odds-pair grid w-full grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center gap-y-1 rounded-lg border px-1 py-2.5 text-center" aria-label="Betting odds and movement">
      <span className="col-start-1 row-start-1 text-sm font-semibold leading-5 tracking-tight tabular-nums" aria-label={`${f1Name}: ${f1 ?? "No odds"}`}>{f1 ?? "—"}</span>
      <span className="col-start-3 row-start-1 text-sm font-semibold leading-5 tracking-tight tabular-nums" aria-label={`${f2Name}: ${f2 ?? "No odds"}`}>{f2 ?? "—"}</span>
      {hasOpen ? <>
        <span className="col-start-1 row-start-2 whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500">{f1Open ? `from ${f1Open}` : ""}</span>
        <span className="col-start-3 row-start-2 whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500">{f2Open ? `from ${f2Open}` : ""}</span>
      </> : null}
      <span className="col-start-2 row-start-1 row-span-2 grid self-stretch">
        {movement ? <Movement movement={movement} name={movement.toward === "f1" ? f1Name : f2Name} /> : <span className="self-center text-[9px] text-zinc-500" aria-hidden="true">vs</span>}
      </span>
    </div>
  );
}
