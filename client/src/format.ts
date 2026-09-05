export function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(parsed);
}

export function formatDateShort(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

export function formatDateShortWithYear(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" })
    .format(parsed)
    .replace(",", "");
}

/** How a bout ended: the method, the round, and — for a finish — the clock it
 *  came at. A decision is only ever reached at the end of the final round, so
 *  its time says nothing that the round has not already said. */
export function formatMethod(method: string | null, round: string | null, time: string | null): string {
  if (!method) return "";
  const parts = [method];
  if (round) parts.push(`R${round}`);
  if (time && !isDecision(method)) parts.push(time);
  return parts.join(" · ");
}

export function isDecision(method: string | null | undefined): boolean {
  return /dec$/i.test((method ?? "").trim());
}

/** Surname only — how fighters are referred to on charts and in tight labels. */
export function lastName(name: string): string {
  return name.trim().split(/\s+/).at(-1) ?? name;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function outcomeClasses(outcome: string | null | undefined): string {
  switch (outcome) {
    case "win":
      return "bg-emerald-100 text-emerald-700";
    case "loss":
      return "bg-rose-100 text-rose-700";
    case "draw":
      return "bg-amber-100 text-amber-700";
    case "nc":
      return "bg-zinc-200 text-zinc-600";
    default:
      return "bg-zinc-100 text-zinc-500";
  }
}

export function outcomeLabel(outcome: string | null | undefined): string {
  switch (outcome) {
    case "win":
      return "W";
    case "loss":
      return "L";
    case "draw":
      return "D";
    case "nc":
      return "NC";
    default:
      return "";
  }
}

/** "-330" / "+280" betting line, or empty. */
export function formatLine(line: string | null | undefined): string {
  return line ?? "";
}

export function rankLabel(ranking: { division: string; rank: string } | null): string {
  if (!ranking) return "";
  return ranking.rank === "C" ? "C" : ranking.rank === "IC" ? "IC" : `#${ranking.rank}`;
}

/** How long ago a synced copy of something arrived, in the coarsest unit that
 * still answers "is this current?". Null when nothing has ever been synced, so
 * a caller can say "not synced yet" rather than imply an age it does not know.
 * A timestamp ahead of this clock reads as "just now"; it never counts down. */
export function relativeAge(timestamp: number | null | undefined, now: number = Date.now()): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** The full local timestamp, for the tooltip behind a rounded age. */
export function exactTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** A start time in the reader's own zone: "7:27 PM". Times come from the API
 *  as absolute instants precisely so this is the only place a zone is chosen,
 *  and the browser's is the right one. */
export function clockTime(timestamp: number | null | undefined): string | null {
  if (timestamp == null || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** How long until something starts: "2h 05m", "12m", "40s". Null once it has.
 *  Deliberately coarse above an hour and exact under a minute — a countdown to
 *  a walkout is watched closely only at the end. */
export function countdown(target: number | null | undefined, now: number = Date.now()): string | null {
  if (target == null || !Number.isFinite(target)) return null;
  const seconds = Math.round((target - now) / 1000);
  if (seconds <= 0) return null;
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}
