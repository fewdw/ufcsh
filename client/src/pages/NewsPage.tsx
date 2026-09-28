import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi, type NewsData, type NewsStory } from "../api";
import { exactTime } from "../format";
import { PAGE } from "../research";
import { searchList } from "../search";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import Freshness from "../components/Freshness";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import RequestNotice from "../components/RequestNotice";
import { FilterSearch, PageState } from "../components/ResearchKit";

/** Outlets switched off, kept by name: an outlet added later starts on. */
const OFF_KEY = "ufcsh:news-off:v1";
const PAGE_SIZE = 40;

function savedOff(): string[] {
  try { return JSON.parse(localStorage.getItem(OFF_KEY) ?? "[]") as string[]; } catch { return []; }
}

/** "12m", "5h", then the day. */
function age(at: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
}

function dayLabel(at: number, now = new Date()): string {
  const day = new Date(at);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(day)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(day);
}

/** A story as this reader sees it: told by the first outlet they keep on. */
type Shown = { story: NewsStory; source: string; url: string; title: string; own: boolean; others: NewsStory["also"] };

function shown(story: NewsStory, off: ReadonlySet<string>): Shown | null {
  const outlets = [{ source: story.source, url: story.url, title: story.title }, ...story.also].filter((outlet) => !off.has(outlet.source));
  if (!outlets.length) return null;
  const [first, ...others] = outlets;
  return { story, ...first, own: first.source === story.source, others };
}

function Tags({ story }: { story: NewsStory }) {
  if (!story.fighters.length && !story.event) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {story.event ? (
        <Link to={`/events/${story.event.id}`}
          className="max-w-full truncate rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-950">
          {story.event.name}
        </Link>
      ) : null}
      {story.fighters.map((fighter) => (
        <Link key={fighter.id} to={`/fighters/${fighter.id}`}
          className="flex items-center gap-1 rounded-full border border-zinc-200 py-0.5 pl-0.5 pr-2 text-[11px] font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-950">
          <Avatar src={fighter.photo_url} name={fighter.name} size="tag" />
          {fighter.name}
        </Link>
      ))}
    </div>
  );
}

function Byline({ item, className = "" }: { item: Shown; className?: string }) {
  return (
    <p className={`text-[11px] text-zinc-500 ${className}`}>
      <span className="font-semibold uppercase tracking-wide text-zinc-800">{item.source}</span>
      <span className="mx-1.5 text-zinc-300">/</span>
      <time dateTime={new Date(item.story.published_at).toISOString()} title={exactTime(item.story.published_at) ?? undefined}>{age(item.story.published_at)}</time>
      {item.others.length ? (
        <>
          <span className="mx-1.5 text-zinc-300">/</span>
          also{" "}
          {item.others.map((other, index) => (
            <span key={other.source}>
              {index ? ", " : ""}
              <a href={other.url} target="_blank" rel="noopener noreferrer" title={other.title} className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900 hover:decoration-zinc-500">{other.source}</a>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

/** A picture from the outlet; if it won't load, the story reads fine without. */
function Picture({ src, className }: { src: string; className: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`bg-zinc-100 object-cover ${className}`} />;
}

const headline = "text-zinc-950 decoration-zinc-300 underline-offset-4 hover:underline";

function Lead({ item }: { item: Shown }) {
  const image = item.own ? item.story.image : null;
  return (
    <article className="grid gap-4 border-b border-zinc-200 pb-6 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-6">
      {image ? <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1}><Picture src={image} className="aspect-[16/9] w-full rounded" /></a> : null}
      <div className={image ? "" : "md:col-span-2"}>
        <Byline item={item} />
        <h2 className="mt-2 text-[22px] font-bold leading-[1.15] tracking-tight sm:text-[28px]">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={headline}>{item.title}</a>
        </h2>
        {item.own && item.story.summary ? <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">{item.story.summary}</p> : null}
        <Tags story={item.story} />
      </div>
    </article>
  );
}

function Second({ item }: { item: Shown }) {
  const image = item.own ? item.story.image : null;
  return (
    <article className="min-w-0">
      {image ? <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1}><Picture src={image} className="mb-3 aspect-[16/9] w-full rounded" /></a> : null}
      <Byline item={item} />
      <h3 className="mt-1.5 text-[16px] font-bold leading-snug tracking-tight">
        <a href={item.url} target="_blank" rel="noopener noreferrer" className={headline}>{item.title}</a>
      </h3>
      {!image && item.own && item.story.summary ? <p className="mt-2 line-clamp-3 text-[13px] leading-relaxed text-zinc-600">{item.story.summary}</p> : null}
      <Tags story={item.story} />
    </article>
  );
}

function Row({ item }: { item: Shown }) {
  const image = item.own ? item.story.image : null;
  return (
    <article className="flex gap-4 border-b border-zinc-100 py-4">
      <div className="min-w-0 flex-1">
        <Byline item={item} />
        <h3 className="mt-1 text-[15px] font-semibold leading-snug">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className={headline}>{item.title}</a>
        </h3>
        {item.own && item.story.summary ? <p className="mt-1 hidden text-[13px] leading-relaxed text-zinc-500 sm:line-clamp-2">{item.story.summary}</p> : null}
        <Tags story={item.story} />
      </div>
      {image ? <a href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} className="shrink-0"><Picture src={image} className="h-16 w-24 rounded sm:h-20 sm:w-32" /></a> : null}
    </article>
  );
}

function Sources({ data, off, setOff }: { data: NewsData; off: ReadonlySet<string>; setOff: (off: string[]) => void }) {
  const on = data.sources.length - data.sources.filter((source) => off.has(source.name)).length;
  const toggle = (name: string, value: boolean) => setOff(value ? [...off].filter((source) => source !== name) : [...off, name]);
  return (
    <OptionsSheet label="Sources" count={on < data.sources.length ? `${on}/${data.sources.length}` : null} onReset={() => setOff([])}>
      <p className="px-4 pb-2 text-[11px] text-zinc-400">Only the outlets you keep on are shown. A story another outlet also ran stays, credited to it.</p>
      <div className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5">
        {data.sources.map((source) => (
          <SwitchRow key={source.name} label={source.name} hint={source.ok ? undefined : "Couldn’t be read lately"} on={!off.has(source.name)} onChange={(value) => toggle(source.name, value)} />
        ))}
      </div>
    </OptionsSheet>
  );
}

export default function NewsPage() {
  const { data, error, retry } = useApi<NewsData>("/api/news", 5 * 60_000);
  const [offList, setOffList] = useState<string[]>(savedOff);
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(PAGE_SIZE);
  useSeo({ title: "UFC News", description: "The latest UFC news from every major outlet in one list: top stories first, every headline linked to its source.", path: "/news" });
  const off = useMemo(() => new Set(offList), [offList]);
  const setOff = (next: string[]) => {
    setOffList(next);
    try { localStorage.setItem(OFF_KEY, JSON.stringify(next)); } catch { /* private mode: for this visit only */ }
  };
  const view = useMemo(() => {
    if (!data) return null;
    const keep = (stories: NewsStory[]) => stories.map((story) => shown(story, off)).filter((item): item is Shown => Boolean(item));
    const text = (item: Shown) => `${item.title} ${item.story.fighters.map((fighter) => fighter.name).join(" ")} ${item.story.event?.name ?? ""}`;
    if (query.trim()) return { top: [], latest: searchList(keep([...data.top, ...data.latest]), query, text).sort((a, b) => b.story.published_at - a.story.published_at) };
    return { top: keep(data.top), latest: keep(data.latest) };
  }, [data, off, query]);

  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the news.</RequestNotice></div>;
  if (!data || !view) return <PageState>Loading the news…</PageState>;
  const [lead, ...second] = view.top;
  const latest = view.latest.slice(0, count);
  let day = "";
  return (
    <div className={PAGE}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-zinc-900 pb-3">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-zinc-950">News</h1>
            <p className="mt-0.5 text-[12px] text-zinc-500">
              UFC stories from {data.sources.filter((source) => !off.has(source.name)).length} outlets · <Freshness label="updated" at={data.updated_at} staleAfterHours={2} />
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-44 sm:w-56"><FilterSearch value={query} onChange={(value) => { setQuery(value); setCount(PAGE_SIZE); }} placeholder="Search headlines" /></div>
            <Sources data={data} off={off} setOff={setOff} />
          </div>
        </header>

        {lead ? (
          <section aria-label="Top stories" className="pt-6">
            <Lead item={lead} />
            {second.length ? (
              <div className="grid gap-x-6 gap-y-8 border-b border-zinc-200 py-6 sm:grid-cols-2 lg:grid-cols-4">
                {second.map((item) => <Second key={item.story.url} item={item} />)}
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-label="Latest" className="pt-6">
          {!latest.length ? <p className="py-10 text-center text-sm text-zinc-500">{query.trim() ? "No headline matches." : "Nothing from the outlets you keep on."}</p> : null}
          {latest.map((item) => {
            const label = dayLabel(item.story.published_at);
            const heading = label !== day ? label : null;
            day = label;
            return (
              <div key={item.story.url}>
                {heading ? <h2 className="mt-6 border-b border-zinc-900 pb-1.5 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-900 first:mt-0">{heading}</h2> : null}
                <Row item={item} />
              </div>
            );
          })}
          {view.latest.length > count ? (
            <button type="button" onClick={() => setCount((current) => current + PAGE_SIZE)}
              className="mt-6 w-full rounded border border-zinc-300 py-2.5 text-[13px] font-semibold text-zinc-700 transition hover:border-zinc-500 hover:text-zinc-950">
              More stories
            </button>
          ) : null}
        </section>
      </div>
    </div>
  );
}
