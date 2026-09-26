import { Tooltip } from "./Tooltip";
import { useTooltip } from "../tooltip";
import { BONUS_TAG, FIGHT_BONUS, PERF_AWARD } from "../bonus";

export type FightBonuses = { perf: boolean; fotn: boolean } | null | undefined;

function BonusIcon({ short, label }: { short: string; label: string }) {
  const { at, id, open, handlers } = useTooltip();
  return (
    <span
      className={`${BONUS_TAG} align-middle`}
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
      {bonuses.fotn ? <BonusIcon short={FIGHT_BONUS.short} label={FIGHT_BONUS.full} /> : null}
      {bonuses.perf && outcome === "win" ? <BonusIcon short={PERF_AWARD.perf.short} label={PERF_AWARD.perf.full} /> : null}
    </span>
  );
}
