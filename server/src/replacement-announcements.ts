import { normName } from "./util.ts";

/** Checked primary reports whose bodies identify the replacement, but whose
 * citation headlines do not. Dates match publisher metadata and date the
 * announcement, never the fighter's acceptance. */
export const VERIFIED_REPLACEMENT_REPORTS = [
  { eventDate: "2017-12-02", name: "Jose Aldo", replaced: "Frankie Edgar", date: "2017-11-11",
    source: "https://www.mmafighting.com/2017/11/11/16633192/max-holloway-vs-jose-aldo-2-slated-as-new-ufc-218-main-event" },
  { eventDate: "2018-06-01", name: "David Teymur", replaced: "Leonardo Santos", date: "2018-05-01",
    source: "https://www.mmafighting.com/2018/5/1/17307374/david-teymur-steps-in-to-fight-nik-lentz-at-ufc-utica" },
  { eventDate: "2022-04-09", name: "Jared Vanderaa", replaced: "Ilir Latifi", date: "2022-03-31",
    source: "https://www.mmafighting.com/2022/3/31/23004738/aleksei-oleinik-now-fights-jared-vanderaa-at-ufc-273-ilir-latifi-out" },
  { eventDate: "2024-10-05", name: "Alexander Hernandez", replaced: "Nate Landwehr", date: "2024-09-18",
    source: "https://www.mmafighting.com/2024/9/18/24248451/ufc-307-veteran-steps-in-to-save-lightweight-bout-on-alex-pereira-vs-khalil-rountree-fight-card" },
  { eventDate: "2024-11-16", name: "Roberto Romero", replaced: "Lucas Almeida", date: "2024-11-13",
    source: "https://www.mmafighting.com/2024/11/13/24295526/ufc-309-fight-card-finalized-with-13th-fight-now-complete" },
  { eventDate: "2026-07-18", name: "Anna Melisano", replaced: "Veronica Hardy", date: "2026-07-06",
    source: "https://www.mmafighting.com/ufc/497873/michael-bispings-no-1-tuf-34-pick-steps-in-to-save-fight-at-ufc-oklahoma-city" },
];

export function verifiedReplacementAnnouncement(name: string, replaced: string, eventDate: string): string | null {
  const reports = VERIFIED_REPLACEMENT_REPORTS.filter(report => report.eventDate === eventDate
    && normName(report.name) === normName(name) && normName(report.replaced) === normName(replaced));
  if (!reports.length) return null;
  const date = reports.map(report => report.date).sort()[0];
  const days = Math.round((Date.parse(eventDate) - Date.parse(date)) / 86_400_000);
  return days >= 0 && days <= 60 ? days === 0 ? "announced on fight day" : `announced ${days} day${days === 1 ? "" : "s"} before` : null;
}
