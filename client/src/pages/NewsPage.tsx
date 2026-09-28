import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NewsPage as NewsData, NewsStory } from "../api";
import { exactTime } from "../format";
import { PAGE } from "../research";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import Freshness from "../components/Freshness";
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
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(at);
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function dayLabel(at: number, now = new Date()): string {
  const day = new Date(at);
  const start = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(day)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(day);
}

const external = { target: "_blank", rel: "noopener noreferrer" } as const;
const headline = "text-zinc-950 decoration-zinc-400 decoration-1 underline-offset-[5px] hover:underline";

function Tags({ story }: { story: NewsStory }) {
  if (!story.fighters.length && !story.event) return null;
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {story.fighters.map((fighter) => (
        <Link key={fighter.id} to={`/fighters/${fighter.id}`} className="group flex items-center gap-1.5 text-[12px] font-medium text-zinc-600 hover:text-zinc-950">
          <Avatar src={fighter.photo_url} name={fighter.name} size="tag" />
          <span className="decoration-zinc-400 underline-offset-2 group-hover:underline">{fighter.name}</span>
        </Link>
      ))}
      {story.event ? (
        <Link to={`/events/${story.event.id}`} className="rounded-sm bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-950">
          {story.event.name}
        </Link>
      ) : null}
    </div>
  );
}

function Byline({ story, time = "age" }: { story: NewsStory; time?: "age" | "none" }) {
  return (
    <p className="text-[11px] leading-4 text-zinc-500">
      <span className="font-bold uppercase tracking-[0.06em] text-zinc-900">{story.source}</span>
      {time === "age" ? <> · <time dateTime={new Date(story.published_at).toISOString()} title={exactTime(story.published_at) ?? undefined}>{age(story.published_at)}</time></> : null}
      {story.also.length ? (
        <> · also{" "}
          {story.also.map((other, index) => (
            <span key={other.source}>
              {index ? ", " : ""}
              <a href={other.url} {...external} title={other.title} className="text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950 hover:decoration-zinc-500">{other.source}</a>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

/** The biggest story: the page's one large headline. */
function Lead({ story }: { story: NewsStory }) {
  return (
    <article>
      <Byline story={story} />
      <h2 className="mt-2 text-[26px] font-extrabold leading-[1.12] tracking-[-0.015em] sm:text-[34px]">
        <a href={story.url} {...external} className={headline}>{story.title}</a>
      </h2>
      {story.summary ? <p className="mt-3 max-w-[62ch] text-[15px] leading-relaxed text-zinc-600 sm:text-[16px]">{story.summary}</p> : null}
      <Tags story={story} />
    </article>
  );
}

function Brief({ story }: { story: NewsStory }) {
  return (
    <article className="border-t border-zinc-200 py-4 first:border-t-0 first:pt-0 lg:first:pt-0">
      <Byline story={story} />
      <h3 className="mt-1.5 text-[16px] font-bold leading-snug tracking-[-0.005em]">
        <a href={story.url} {...external} className={headline}>{story.title}</a>
      </h3>
      <Tags story={story} />
    </article>
  );
}

/** A line of the running list: the time on the left, the story on the right. */
function Row({ story }: { story: NewsStory }) {
  return (
    <article className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3 border-t border-zinc-100 py-4 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
      <time dateTime={new Date(story.published_at).toISOString()} title={exactTime(story.published_at) ?? undefined}
        className="pt-px text-[12px] tabular-nums text-zinc-400">
        {clock.format(story.published_at)}
      </time>
      <div className="min-w-0">
        <Byline story={story} time="none" />
        <h3 className="mt-1 text-[15px] font-semibold leading-snug sm:text-[16px]">
          <a href={story.url} {...external} className={headline}>{story.title}</a>
        </h3>
        {story.summary ? <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-zinc-500">{story.summary}</p> : null}
        <Tags story={story} />
      </div>
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
  const [lead, ...briefs] = first.top;
  let day = "";
  return (
    <div className={PAGE}>
      <div className="mx-auto w-full max-w-5xl px-4 pb-16 pt-5 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b-[3px] border-double border-zinc-900 pb-3 dark:border-zinc-500">
          <div>
            <h1 className="text-[32px] font-black leading-none tracking-[-0.02em] text-zinc-950">News</h1>
            <p className="mt-1.5 text-[12px] text-zinc-500">
              UFC stories from {first.sources.filter((source) => !off.has(source.name)).length} outlets · <Freshness label="updated" at={first.updated_at} staleAfterHours={2} />
            </p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="w-44 sm:w-60"><FilterSearch value={query} onChange={setQuery} placeholder="Search the news" /></div>
            <Sources sources={first.sources} off={off} setOff={setOff} />
          </div>
        </header>

        {lead ? (
          <section aria-label="Top stories" className="grid gap-y-6 border-b border-zinc-900 py-6 dark:border-zinc-600 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:gap-x-8">
            <Lead story={lead} />
            {briefs.length ? (
              <div className="border-t border-zinc-200 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                {briefs.map((story) => <Brief key={story.url} story={story} />)}
              </div>
            ) : null}
          </section>
        ) : null}

        <section aria-label={query.trim() ? "Search results" : "Latest"} className="pt-6">
          {query.trim() ? <h2 className="pb-2 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-900">{first.total} {first.total === 1 ? "story" : "stories"} for “{query.trim()}”</h2> : null}
          {!list.items.length ? <p className="py-10 text-center text-sm text-zinc-500">{query.trim() ? "Nothing matches." : "Nothing from the outlets you keep on."}</p> : null}
          {list.items.map((story, index) => {
            const label = dayLabel(story.published_at);
            const heading = label !== day ? label : null;
            day = label;
            return (
              <div key={story.url}>
                {heading ? <h2 className={`${index ? "mt-8" : ""} pb-1 text-[12px] font-bold uppercase tracking-[0.12em] text-zinc-900`}>{heading}</h2> : null}
                <Row story={story} />
              </div>
            );
          })}
          <LoadMore list={list} />
        </section>
      </div>
    </div>
  );
}
