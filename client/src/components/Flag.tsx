import { flagEmoji } from "../flags";

/**
 * A fighter's nationality: the flag, with the country in its tooltip.
 *
 * The country is never carried by the picture alone — it is the accessible
 * name and the title — and when no flag can be built from the code, the name
 * itself is shown instead of nothing.
 */
export default function Flag({ code, name, className = "" }: { code: string | null | undefined; name?: string | null; className?: string }) {
  const flag = flagEmoji(code);
  const label = name || (code ?? "").toUpperCase();
  if (!label) return null;
  if (!flag) {
    return <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 ${className}`} title={label}>{label}</span>;
  }
  return <span role="img" aria-label={label} title={label} className={`shrink-0 leading-none ${className}`}>{flag}</span>;
}
