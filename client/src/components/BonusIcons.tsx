import { Tooltip } from "./Tooltip";
import { useTooltip } from "../tooltip";

export type FightBonuses = { perf: boolean; fotn: boolean } | null | undefined;

function BonusIcon({ short, label }: { short: string; label: string }) {
  const { at, id, open, handlers } = useTooltip();
  return (
    <span
      className="inline-flex shrink-0 cursor-default items-center rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[9px] font-bold uppercase leading-4 tracking-[0.08em] text-amber-700"
      aria-label={label}
      aria-describedby={open ? id : undefined}
      tabIndex={0}
      {...handlers}
    >
      <span aria-hidden="true">{short}</span>
      <Tooltip id={id} at={at}>{label}</Tooltip>
    </span>
  );
}

export default function BonusIcons({ bonuses, outcome }: { bonuses: FightBonuses; outcome: string | null }) {
  if (!bonuses?.fotn && !(bonuses?.perf && outcome === "win")) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label="Fight bonuses">
      {bonuses.fotn ? <BonusIcon short="FOTN" label="Fight of the Night" /> : null}
      {bonuses.perf && outcome === "win" ? <BonusIcon short="POTN" label="Performance of the Night" /> : null}
    </span>
  );
}
