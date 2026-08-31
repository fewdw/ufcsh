export type FightBonuses = { perf: boolean; fotn: boolean } | null | undefined;

function BonusIcon({ emoji, label }: { emoji: string; label: string }) {
  return (
    <span
      className="group/bonus relative inline-flex shrink-0 cursor-default align-middle"
      aria-label={label}
      tabIndex={0}
    >
      <span aria-hidden="true" className="text-[0.9em] leading-none">
        {emoji}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[10px] font-medium leading-snug text-white shadow-lg group-hover/bonus:block group-focus-visible/bonus:block"
      >
        {label}
      </span>
    </span>
  );
}

export default function BonusIcons({ bonuses, outcome }: { bonuses: FightBonuses; outcome: string | null }) {
  if (!bonuses?.fotn && !(bonuses?.perf && outcome === "win")) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label="Fight bonuses">
      {bonuses.fotn ? <BonusIcon emoji="🏆" label="Fight of the Night" /> : null}
      {bonuses.perf && outcome === "win" ? <BonusIcon emoji="💰" label="Performance of the Night" /> : null}
    </span>
  );
}
