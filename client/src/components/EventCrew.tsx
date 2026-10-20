import { Fragment } from "react";
import { useApi } from "../api";
import { PANEL } from "./chartTokens";

type CrewData = { broadcast: { roles: Record<string, string[]> } | null };
const crewUrl = (eventId: string) => `/api/events/${eventId}/crew`;
// Paired roles share a label, lead role first.
const CREW: [string, string[]][] = [
  ["Commentary", ["play_by_play", "color_commentary"]], ["Announcer", ["announcer"]], ["Reporter", ["reporter"]],
  ["Desk", ["desk_host", "desk_analysts"]], ["Weigh-in", ["weigh_in_host", "weigh_in_analysts"]],
];

export default function EventCrew({ eventId }: { eventId: string }) {
  const { data } = useApi<CrewData>(crewUrl(eventId), 5 * 60_000);
  const broadcast = data?.broadcast;
  if (!broadcast) return null;
  // Narrow: labels in one column, names wrapping beside them. Wide: one flowing line.
  // A name never splits across lines; its dot stays with the name before it.
  return <section aria-label="Broadcast crew" className={`${PANEL} shrink-0 px-3 py-2.5 text-xs leading-5 @[34rem]:px-5`}>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 @[34rem]:flex @[34rem]:flex-wrap @[34rem]:gap-x-5 @[34rem]:gap-y-1">
      {CREW.map(([label, roles]) => {
        const names = roles.flatMap(role => broadcast.roles[role] ?? []);
        return names.length ? <div key={label} className="contents @[34rem]:flex @[34rem]:gap-1.5">
          <dt className="font-semibold text-zinc-900">{label}</dt>
          <dd className="text-zinc-600">{names.map((name, i) => <Fragment key={name}>{i ? "\u00a0· " : null}<span className="whitespace-nowrap">{name}</span></Fragment>)}</dd>
        </div> : null;
      })}
    </dl>
  </section>;
}
