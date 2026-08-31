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

export function formatMethod(method: string | null, round: string | null, time: string | null): string {
  if (!method) return "";
  const parts = [method];
  if (round) parts.push(`R${round}`);
  if (time) parts.push(time);
  return parts.join(" · ");
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
