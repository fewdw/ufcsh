import type { CareerRosterEvent, HistoryRow, ProfessionalHistoryRow } from "./api";

type Bout = HistoryRow | ProfessionalHistoryRow;
export type FightProgram = "Contender Series" | "Road to UFC" | "TUF";

export function fightProgram(event: string): FightProgram | null {
  const name = event.replace(/[’‘]/g, "'").replace(/^UFC\s*[-:]\s*/i, "").trim();
  if (/^(?:Dana White(?:'s)? (?:Tuesday Night )?Contender Series|DWCS|DWTNCS)\b/i.test(name)) return "Contender Series";
  if (/^Road to UFC\b/i.test(name)) return "Road to UFC";
  if (/^(?:The Ultimate Fighter|TUF)\b/i.test(name)) return "TUF";
  return null;
}

export type CareerBand = {
  label: string;
  detail: string;
  date?: string;
  observed?: boolean;
  source_url?: string;
  signing: boolean;
};

/** A TUF finale is a real UFC event, including its undercard. TV exhibition
 * bouts, DWCS and Road to UFC appearances do not establish a UFC contract. */
function recruitmentBout(row: Bout): boolean {
  const program = fightProgram(row.event_name);
  return program === "Contender Series" || program === "Road to UFC" || row.title_type === "tuf"
    || (row.title_type === "tournament" && row.date >= "2001-01-01")
    || (program === "TUF" && !/\bfinale\b|\bfinal\b/i.test(row.event_name) && !row.fight_id);
}

function regularUfc(row: Bout): boolean {
  return row.promotion !== "outside" && !recruitmentBout(row);
}

/** Slots surround the newest-first fights: slot 0 above the newest bout,
 * slot 1 between bouts 0 and 1, etc. Report dates retain their own position;
 * bout evidence never invents a signing date or a reason for leaving. */
export function careerBands(rows: Bout[], reports: CareerRosterEvent[] = []): CareerBand[][] {
  const bands: CareerBand[][] = Array.from({ length: rows.length + 1 }, () => []);
  const valid = reports.filter(event => /^\d{4}-\d{2}-\d{2}$/.test(event.date)
    && Number.isFinite(Date.parse(event.date)) && new Date(event.date).toISOString().slice(0, 10) === event.date);
  const events = valid.filter((event, index) => !valid.slice(0, index).some(other => other.date === event.date && other.kind === event.kind && other.observed === event.observed))
    .filter(event => !event.observed || !valid.some(other => !other.observed
      && (other.kind === "signed") === (event.kind === "signed")
      && Math.abs(Date.parse(other.date) - Date.parse(event.date)) <= 30 * 86_400_000))
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const event of events) {
    const slot = rows.findIndex(row => event.kind === "signed" ? row.date < event.date : row.date <= event.date);
    bands[slot < 0 ? rows.length : slot].push({
      label: event.kind === "signed" ? "Signed to UFC" : event.kind === "released" ? "Cut from UFC"
        : event.kind === "retired" ? "Retired from UFC" : "Left UFC roster",
      detail: [event.observed ? "Roster change first observed on this date; contract date unknown." : "Reported roster change.", event.reason].filter(Boolean).join(" "),
      date: event.date, observed: event.observed, source_url: event.source_url, signing: event.kind === "signed",
    });
  }

  const completed = rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.upcoming && row.outcome !== null);
  const hasReport = (kind: "signed" | "left", from: string | undefined, through: string | undefined) => events.some(event =>
    (event.kind === "signed") === (kind === "signed") && (!from || event.date >= from)
    && (!through || event.date <= through || (kind === "signed" && event.observed && Date.parse(event.date) - Date.parse(through) <= 30 * 86_400_000)));
  for (let i = 0; i < completed.length; i++) {
    const { row, index } = completed[i];
    if (!regularUfc(row)) continue;
    // Recruitment appearances are skipped when comparing actual UFC runs.
    const older = completed.slice(i + 1).find(({ row: bout }) => !recruitmentBout(bout));
    const newer = completed.slice(0, i).findLast(({ row: bout }) => !recruitmentBout(bout));
    if (!older || older.row.promotion === "outside") {
      if (!hasReport("signed", older?.row.date, row.date)) {
        const returned = completed.slice(i + 1).some(({ row: bout }) => regularUfc(bout));
        bands[index + 1].push({
          label: returned ? "Returned to UFC" : row.date < "2001-01-01" ? "UFC debut" : "Signed to UFC",
          detail: returned ? "Confirmed by the next completed UFC appearance; contract date unknown."
            : "Confirmed by a completed UFC appearance. Placed before the debut; exact signing date unknown.",
          signing: true,
        });
      }
    }
    if (newer?.row.promotion === "outside" && !hasReport("left", row.date, newer.row.date)) {
      bands[index].push({ label: "Last UFC fight", detail: "Last UFC appearance before the next outside-UFC bout. Departure date and reason are unconfirmed.", signing: false });
    }
  }
  return bands;
}
