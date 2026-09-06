export default function SearchFeedback({ searching, error, retry, empty }: {
  searching: boolean;
  error: boolean;
  retry: () => void;
  empty: string;
}) {
  return (
    <div role={error ? "alert" : "status"} className="px-3 py-7 text-center text-xs text-zinc-500">
      {error ? <><p>Search couldn’t load. Please try again.</p><button type="button" onClick={retry} className="mt-3 rounded-full border border-zinc-200 px-3 py-1.5 font-medium text-zinc-900 hover:bg-zinc-50">Try again</button></>
        : searching ? "Searching…" : empty}
    </div>
  );
}
