import { flagEmoji } from "../flags";

/** A nationality flag; the country name is its accessible label, and the
 * fallback when no flag can be built. */
export default function Flag({ code, name, className = "" }: { code: string | null | undefined; name?: string | null; className?: string }) {
  const flag = flagEmoji(code);
  const label = name || (code ?? "").toUpperCase();
  if (!label) return null;
  if (!flag) {
    return <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 ${className}`} title={label}>{label}</span>;
  }
  return <span role="img" aria-label={label} title={label} className={`shrink-0 leading-none ${className}`}>{flag}</span>;
}
