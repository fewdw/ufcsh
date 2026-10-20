import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Play, Video, X } from "lucide-react";
import { useApi } from "../api";
import { PANEL } from "./chartTokens";
import EvidenceDialog from "./EvidenceDialog";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";

type EventVideo = {
  id: string; title: string; source: string; channel_id: string; category: string;
  section: "official" | "showcase"; published_at: string | null; occurred_at: string | null;
  duration: string | null; status: "replay" | "live" | "scheduled"; spoilers: boolean;
};
type MediaData = {
  broadcast: { language: string; feed: string; source_url: string; reported_at: string; roles: Record<string, string[]> } | null;
  categories: Record<string, string>;
  videos: EventVideo[];
  sources: { id: string; name: string; url: string }[];
};
const mediaUrl = (eventId: string) => `/api/events/${eventId}/media`;
const hasMedia = (data: MediaData | null) => Boolean(data && (data.broadcast || data.videos.length));
// The crew reads as one line, so paired roles share a label, lead role first.
const CREW: [string, string[]][] = [
  ["Commentary", ["play_by_play", "color_commentary"]], ["Announcer", ["announcer"]], ["Reporter", ["reporter"]],
  ["Desk", ["desk_host", "desk_analysts"]], ["Weigh-in", ["weigh_in_host", "weigh_in_analysts"]],
];
const youtube = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const dateLabel = (date: string | null) => date ? new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
const filterStyle = "min-h-8 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2";

function VideoPlayer({ video, close }: { video: EventVideo; close: () => void }) {
  const id = useId();
  return createPortal(
    <EvidenceDialog id={id} close={close} wide>
      <div className="flex shrink-0 items-start justify-between gap-4 px-4 py-3">
        <h2 id={`${id}-title`} tabIndex={-1} className={`${DIALOG_TITLE} text-balance`}>{video.title}</h2>
        <button type="button" aria-label="Close video" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div className="flex min-h-0 flex-1 items-center bg-black">
        <iframe className="aspect-video max-h-full w-full" src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
          title={video.title} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
      <a href={youtube(video.id)} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1.5 px-4 py-3 text-xs font-medium text-zinc-600 hover:text-zinc-950">
        Watch on YouTube <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </a>
    </EvidenceDialog>, document.body,
  );
}

function VideoCard({ video, data, play }: { video: EventVideo; data: MediaData; play: () => void }) {
  const source = data.sources.find(source => source.id === video.source);
  return <article className="group min-w-0">
    <button type="button" onClick={play} aria-label={`Play ${video.title}`} className="relative block aspect-video w-full overflow-hidden rounded-xl bg-zinc-100 text-left focus-visible:outline-2 focus-visible:outline-offset-2">
      <img src={`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`} alt="" loading="lazy" decoding="async" width="480" height="360"
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none" />
      <span className="absolute inset-0 flex items-center justify-center bg-black/5 transition-colors group-hover:bg-black/20">
        <span className="flex h-9 w-12 items-center justify-center rounded-xl bg-black/75 text-white"><Play className="h-4 w-4 fill-current" aria-hidden="true" /></span>
      </span>
      {video.status !== "replay" ? <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${video.status === "live" ? "bg-red-600 text-white" : "bg-black/80 text-white"}`}>{video.status === "live" ? "Live" : "Scheduled"}</span> : null}
      {video.duration ? <span className="absolute bottom-2 right-2 rounded bg-black/85 px-1 py-0.5 text-[10px] font-medium tabular-nums text-white">{video.duration}</span> : null}
    </button>
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] leading-4 text-zinc-500">
      <span className="font-medium text-zinc-600">{data.categories[video.category]}</span>
      {dateLabel(video.occurred_at ?? video.published_at) ? <><span aria-hidden="true">·</span><time dateTime={video.occurred_at ?? video.published_at ?? undefined}>{dateLabel(video.occurred_at ?? video.published_at)}</time></> : null}
      {video.spoilers ? <span className="rounded bg-amber-50 px-1 text-amber-700 dark:bg-amber-950 dark:text-amber-300">Post-fight</span> : null}
    </div>
    <button type="button" onClick={play} className="mt-0.5 block w-full text-left text-xs font-semibold leading-5 text-zinc-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2">
      <span className="line-clamp-2">{video.title}</span>
    </button>
    <a href={source?.url ?? `https://www.youtube.com/channel/${video.channel_id}`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-950">
      {source?.name ?? video.source}<ExternalLink className="h-2.5 w-2.5" aria-hidden="true" />
    </a>
  </article>;
}

function VideoGallery({ section, data, play }: { section: "official" | "showcase"; data: MediaData; play: (video: EventVideo) => void }) {
  const [source, setSource] = useState("");
  const [category, setCategory] = useState("");
  const [phase, setPhase] = useState("");
  const [limit, setLimit] = useState(12);
  const id = useId();
  const all = data.videos.filter(video => video.section === section);
  const publishers = data.sources.filter(source => all.some(video => video.source === source.id));
  const categories = Object.entries(data.categories).filter(([category]) => all.some(video => video.category === category));
  const filtered = all.filter(video => (!source || video.source === source) && (!category || video.category === category)
    && (!phase || (phase === "post" ? video.spoilers : !video.spoilers)));
  // Fight week reads from its first upload forward; commentary shows the latest first.
  const videos = section === "showcase" ? [...filtered].reverse() : filtered;
  const change = (set: (value: string) => void, value: string) => { set(value); setLimit(12); };
  if (!all.length) return null;
  return <section aria-labelledby={`${id}-title`} className={`${PANEL} shrink-0 overflow-hidden`}>
    <div className="border-b border-zinc-100 px-3 py-3 @[34rem]:px-5">
      <div className="flex items-center gap-2">
        <Video className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        <h2 id={`${id}-title`} className="text-sm font-semibold text-zinc-900">{section === "official" ? "Fight week" : "Creator showcase"}</h2>
        <span className="text-xs tabular-nums text-zinc-400">{all.length}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-500">{section === "official" ? "Official videos and on-site coverage, in chronological order." : "Previews, interviews, breakdowns and reactions from MMA channels."}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <select aria-label={`${section === "official" ? "Fight week" : "Showcase"} channel`} value={source} onChange={event => change(setSource, event.target.value)} className={`${filterStyle} max-w-full`}>
          <option value="">All channels</option>{publishers.map(source => <option key={source.id} value={source.id}>{source.name}</option>)}
        </select>
        <select aria-label={`${section === "official" ? "Fight week" : "Showcase"} category`} value={category} onChange={event => change(setCategory, event.target.value)} className={`${filterStyle} max-w-full`}>
          <option value="">All videos</option>{categories.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select aria-label={`${section === "official" ? "Fight week" : "Showcase"} timing`} value={phase} onChange={event => change(setPhase, event.target.value)} className={filterStyle}>
          <option value="">Before & after</option><option value="pre">Before the fights</option><option value="post">Post-fight</option>
        </select>
      </div>
    </div>
    <div className="px-3 py-4 @[34rem]:px-5">
      {videos.length ? <div className="grid grid-cols-1 gap-x-4 gap-y-6 @[22rem]:grid-cols-2 @[48rem]:grid-cols-3 @[72rem]:grid-cols-4">
        {videos.slice(0, limit).map(video => <VideoCard key={video.id} video={video} data={data} play={() => play(video)} />)}
      </div> : <p className="py-3 text-xs text-zinc-500">No videos match these filters.</p>}
      {videos.length > limit ? <button type="button" onClick={() => setLimit(limit + 12)} className="mt-5 w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50">Show more videos ({videos.length - limit} remaining)</button> : null}
    </div>
  </section>;
}

/** Header jump link, shown only once the event has a crew or videos. */
export function EventMediaLink({ eventId }: { eventId: string }) {
  const { data } = useApi<MediaData>(mediaUrl(eventId));
  return hasMedia(data) ? <a href="#event-media" className="font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950">Media & broadcast</a> : null;
}

export default function EventMedia({ eventId }: { eventId: string }) {
  const { data, error } = useApi<MediaData>(mediaUrl(eventId), 5 * 60_000);
  const [playing, setPlaying] = useState<EventVideo | null>(null);
  const loaded = Boolean(data);
  useEffect(() => {
    if (loaded && window.location.hash === "#event-media") document.getElementById("event-media")?.scrollIntoView({ block: "start" });
  }, [loaded]);
  if (!data) return error ? <section id="event-media" className={`${PANEL} shrink-0 p-4 text-xs text-zinc-500`} role="status">Event media could not be loaded.</section> : null;
  if (!hasMedia(data)) return null;
  const broadcast = data.broadcast;
  return <div id="event-media" className="flex shrink-0 scroll-mt-3 flex-col gap-3">
    {broadcast ? <section aria-label="Broadcast team" className={`${PANEL} px-3 py-2.5 text-xs leading-5 @[34rem]:px-5`}>
      <dl className="flex flex-wrap gap-x-5 gap-y-1">
        {CREW.map(([label, roles]) => {
          const names = roles.flatMap(role => broadcast.roles[role] ?? []);
          return names.length ? <div key={label} className="flex gap-1.5">
            <dt className="font-semibold text-zinc-900">{label}</dt>
            <dd className="text-zinc-600">{names.join(" · ")}</dd>
          </div> : null;
        })}
      </dl>
    </section> : null}
    <VideoGallery section="official" data={data} play={setPlaying} />
    <VideoGallery section="showcase" data={data} play={setPlaying} />
    {playing ? <VideoPlayer video={playing} close={() => setPlaying(null)} /> : null}
  </div>;
}
