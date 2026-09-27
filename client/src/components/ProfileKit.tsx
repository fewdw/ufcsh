import type { ReactNode } from "react";
import { ArrowUpRight, ChevronLeft, MapPin, Scale, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

export function ProfileHeader({ kind, title, meta, children, aside }: {
  kind: "venue" | "judge" | "referee"; title: string; meta: ReactNode; children?: ReactNode; aside?: ReactNode;
}) {
  const Icon = kind === "venue" ? MapPin : kind === "judge" ? Scale : ShieldCheck;
  return <header className="profile-hero">
    <Icon className="profile-watermark" strokeWidth={0.7} aria-hidden="true" />
    <div className="relative flex flex-wrap items-center justify-between gap-3">
      <Link to={kind === "venue" ? "/venues" : "/officials"} className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"><ChevronLeft size={14} />All {kind === "venue" ? "venues" : "officials"}</Link>
      {aside}
    </div>
    <div className="relative mt-6">
      <p className="profile-eyebrow"><Icon size={14} aria-hidden="true" />UFC {kind === "venue" ? "venue history" : `${kind} profile`}</p>
      <h1 className="mt-2 break-words text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-zinc-500">{meta}</p>
      {children}
    </div>
  </header>;
}

export function ProfileStats({ children }: { children: ReactNode }) {
  return <div className="profile-stats">{children}</div>;
}

export function ProfileStat({ label, value, detail, onClick }: { label: string; value: ReactNode; detail: ReactNode; onClick?: () => void }) {
  const content = <><span className="flex items-center justify-between gap-2 text-xs font-medium text-zinc-500">{label}{onClick ? <ArrowUpRight size={14} aria-hidden="true" /> : null}</span><strong className="mt-2 block text-3xl font-semibold tabular-nums tracking-tight text-zinc-950 sm:text-4xl">{value}</strong><span className="mt-2 block text-xs leading-5 text-zinc-500">{detail}</span></>;
  return onClick ? <button type="button" onClick={onClick} className="profile-stat text-left">{content}</button> : <div className="profile-stat">{content}</div>;
}

export function QuickFilters({ value, onChange, options, label = "Quick filters" }: { value: string | null; onChange: (value: string | null) => void; options: { value: string; label: string }[]; label?: string }) {
  return <div className="profile-quick" role="group" aria-label={label}>{options.map((option) => <button key={option.value} type="button" aria-pressed={(value ?? "") === option.value} onClick={() => onChange(option.value || null)}>{option.value === "title" ? <Trophy size={13} aria-hidden="true" /> : null}{option.label}</button>)}</div>;
}

export function Breakdown({ title, segments, note }: { title: string; segments: { label: string; value: number; color: string }[]; note?: string }) {
  const total = segments.reduce((sum, entry) => sum + entry.value, 0);
  return <div className="px-4 py-4 sm:px-5">
    <h3 className="text-xs font-semibold text-zinc-700">{title}</h3>
    <div className="my-3 flex h-3 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">{segments.filter(entry => entry.value > 0).map(entry => <span key={entry.label} style={{ width: `${entry.value / total * 100}%`, background: entry.color }} />)}</div>
    <div className="flex flex-wrap gap-x-5 gap-y-2">{segments.map(entry => <span key={entry.label} className="flex items-center gap-1.5 text-xs text-zinc-500"><span className="h-2 w-2 rounded-full" style={{ background: entry.color }} aria-hidden="true" />{entry.label}<strong className="font-semibold tabular-nums text-zinc-900">{entry.value.toLocaleString()}</strong></span>)}</div>
    {note ? <p className="mt-3 text-[11px] leading-5 text-zinc-400">{note}</p> : null}
  </div>;
}
