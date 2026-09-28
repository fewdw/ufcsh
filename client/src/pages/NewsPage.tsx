import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NewsPage as NewsData, NewsStory } from "../api";
import { exactTime } from "../format";
import { PAGE } from "../research";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import { fetchPage, LoadMore, useInfiniteList } from "../components/InfiniteList";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import RequestNotice from "../components/RequestNotice";
import { FilterSearch, PageState } from "../components/ResearchKit";

/** Outlets switched off, kept by name: an outlet added later starts on. */
const OFF_KEY = "ufcsh:news-off:v1";

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

const external = { target: "_blank", rel: "noopener noreferrer" } as const;

/** One story, the same for every story: the outlet, who and what it is about
 *  and when on the first line; the headline, linked to the outlet, below. */
function Row({ story }: { story: NewsStory }) {
  const also = story.also.map((other) => other.source).join(", ");
  return (
    <article className="border-t border-zinc-100 py-3.5 first:border-t-0 not-dark:border-zinc-200">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] leading-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-zinc-900">
          {story.source}
          {also ? <span className="ml-1 font-medium normal-case tracking-normal text-zinc-400" title={`Also ${also}`} aria-label={`also ${also}`}>+{story.also.length}</span> : null}
        </span>
        {story.fighters.map((fighter) => (
          <Link key={fighter.id} to={`/fighters/${fighter.id}`} className="group flex items-center gap-1.5 font-medium text-zinc-600 hover:text-zinc-950">
            <Avatar src={fighter.photo_url} name={fighter.name} size="tag" />
            <span className="decoration-zinc-400 underline-offset-2 group-hover:underline">{fighter.name}</span>
          </Link>
        ))}
        {story.event ? (
          <Link to={`/events/${story.event.id}`} className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-950">
            {story.event.name}
          </Link>
        ) : null}
        <time dateTime={new Date(story.published_at).toISOString()} title={exactTime(story.published_at) ?? undefined} className="tabular-nums text-zinc-400">
          {age(story.published_at)}
        </time>
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold leading-snug sm:text-[16px]">
        <a href={story.url} {...external} className="text-zinc-950 decoration-zinc-400 decoration-1 underline-offset-[5px] hover:underline">{story.title}</a>
      </h3>
    </article>
  );
}

function Sources({ sources, off, setOff }: { sources: NewsData["sources"]; off: ReadonlySet<string>; setOff: (off: string[]) => void }) {
  const on = sources.filter((source) => !off.has(source.name)).length;
  const toggle = (name: string, value: boolean) => setOff(value ? [...off].filter((source) => source !== name) : [...off, name]);
  return (
    <OptionsSheet label="Sources" count={on < sources.length ? `${on}/${sources.length}` : null} onReset={() => setOff([])}>
      <p className="px-4 pb-2 text-[11px] text-zinc-400">A story another outlet you keep on also ran stays, credited to that outlet.</p>
      <div className="max-h-[60vh] overflow-y-auto px-1.5 pb-1.5">
        {sources.map((source) => (
          <SwitchRow key={source.name} label={source.name} hint={source.ok ? undefined : "Couldn’t be read lately"} on={!off.has(source.name)} onChange={(value) => toggle(source.name, value)} />
        ))}
      </div>
    </OptionsSheet>
  );
}

export default function NewsPage() {
  const [offList, setOffList] = useState<string[]>(savedOff);
  const [query, setQuery] = useState("");
  useSeo({ title: "UFC News", description: "The latest UFC news from every major outlet in one list: top stories first, every headline linked to its source.", path: "/news" });
  const off = useMemo(() => new Set(offList), [offList]);
  const setOff = (next: string[]) => {
    setOffList(next);
    try { localStorage.setItem(OFF_KEY, JSON.stringify(next)); } catch { /* private mode: for this visit only */ }
  };
  const search = useMemo(() => {
    const params = new URLSearchParams();
    if (offList.length) params.set("off", [...offList].sort().join(","));
    if (query.trim()) params.set("q", query.trim());
    return params.toString();
  }, [offList, query]);
  const list = useInfiniteList({
    resetKey: search,
    load: (offset) => {
      const params = [search, offset ? `offset=${offset}` : ""].filter(Boolean).join("&");
      return fetchPage<NewsData>(params ? `/api/news?${params}` : "/api/news", {}, "The news could not be loaded.");
    },
    items: (page) => page.latest,
    itemKey: (story) => story.url,
  });

  const first = list.first;
  if (!first) {
    return list.error
      ? <div className="p-4"><RequestNotice onRetry={() => void list.retry()}>Couldn’t load the news.</RequestNotice></div>
      : <PageState>Loading the news…</PageState>;
  }
  const stories = [...first.top, ...list.items];
  return (
    <div className={PAGE}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 pb-2">
          <div className="min-w-0 flex-1 sm:max-w-80"><FilterSearch value={query} onChange={setQuery} placeholder="Search the news" /></div>
          <Sources sources={first.sources} off={off} setOff={setOff} />
        </div>

        <section aria-label={query.trim() ? "Search results" : "News"}>
          {query.trim() ? <h2 className="py-2 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-900">{first.total} {first.total === 1 ? "story" : "stories"} for “{query.trim()}”</h2> : null}
          {!stories.length ? <p className="py-10 text-center text-sm text-zinc-500">{query.trim() ? "Nothing matches." : "Nothing from the outlets you keep on."}</p> : null}
          {stories.map((story) => <Row key={story.url} story={story} />)}
          <LoadMore list={list} />
        </section>
      </div>
    </div>
  );
}
