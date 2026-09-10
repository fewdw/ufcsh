import { Tooltip } from "./Tooltip";
import { useTooltip } from "../tooltip";

export type FightBonuses = { perf: boolean; fotn: boolean } | null | undefined;

function BonusIcon({ emoji, label }: { emoji: string; label: string }) {
  const { at, id, open, handlers } = useTooltip();
  return (
    <span
      className="inline-flex shrink-0 cursor-default align-middle"
      aria-label={label}
      aria-describedby={open ? id : undefined}
      tabIndex={0}
      {...handlers}
    >
      <span aria-hidden="true" className="text-[0.9em] leading-none">{emoji}</span>
      <Tooltip id={id} at={at}>{label}</Tooltip>
    </span>
  );
}

export default function BonusIcons({ bonuses, outcome }: { bonuses: FightBonuses; outcome: string | null }) {
  if (!bonuses?.fotn && !(bonuses?.perf && outcome === "win")) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label="Fight bonuses">
      {bonuses.fotn ? <BonusIcon emoji="🔥" label="Fight of the Night" /> : null}
      {bonuses.perf && outcome === "win" ? <BonusIcon emoji="💰" label="Performance of the Night" /> : null}
    </span>
  );
}
