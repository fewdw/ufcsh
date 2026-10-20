import { useEffect } from "react";
import { useApi } from "../api";
import { PANEL } from "./chartTokens";

type CrewData = { broadcast: { roles: Record<string, string[]> } | null };
const crewUrl = (eventId: string) => `/api/events/${eventId}/crew`;
// The crew reads as one line, so paired roles share a label, lead role first.
const CREW: [string, string[]][] = [
  ["Commentary", ["play_by_play", "color_commentary"]], ["Announcer", ["announcer"]], ["Reporter", ["reporter"]],
  ["Desk", ["desk_host", "desk_analysts"]], ["Weigh-in", ["weigh_in_host", "weigh_in_analysts"]],
];

/** Header jump link, shown only once the card has a crew. */
export function EventCrewLink({ eventId }: { eventId: string }) {
  const { data } = useApi<CrewData>(crewUrl(eventId));
  return data?.broadcast ? <a href="#event-crew" className="font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950">Broadcast crew</a> : null;
}

export default function EventCrew({ eventId }: { eventId: string }) {
  const { data } = useApi<CrewData>(crewUrl(eventId), 5 * 60_000);
  const broadcast = data?.broadcast;
  useEffect(() => {
    if (broadcast && window.location.hash === "#event-crew") document.getElementById("event-crew")?.scrollIntoView({ block: "start" });
  }, [broadcast]);
  if (!broadcast) return null;
  return <section id="event-crew" aria-label="Broadcast crew" className={`${PANEL} shrink-0 scroll-mt-3 px-3 py-2.5 text-xs leading-5 @[34rem]:px-5`}>
    <dl className="flex flex-wrap gap-x-5 gap-y-1">
      {CREW.map(([label, roles]) => {
        const names = roles.flatMap(role => broadcast.roles[role] ?? []);
        return names.length ? <div key={label} className="flex gap-1.5">
          <dt className="font-semibold text-zinc-900">{label}</dt>
          <dd className="text-zinc-600">{names.join(" · ")}</dd>
        </div> : null;
      })}
    </dl>
  </section>;
}
