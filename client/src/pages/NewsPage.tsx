import { useMemo, useState } from "react";
import type { NewsPage as NewsData } from "../api";
import { PAGE } from "../research";
import { useSeo } from "../seo";
import NewsRow, { OFF_KEY, savedOff } from "../components/NewsRow";
import { fetchPage, LoadMore, useInfiniteList } from "../components/InfiniteList";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import RequestNotice from "../components/RequestNotice";
import { FilterSearch, PageState } from "../components/ResearchKit";

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
  useSeo({ title: "UFC News", description: "The latest UFC news from every major outlet in one list, newest first, every headline linked to its source.", path: "/news" });
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
  const stories = list.items;
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
          {stories.map((story) => <NewsRow key={story.url} story={story} />)}
          <LoadMore list={list} />
        </section>
      </div>
    </div>
  );
}
