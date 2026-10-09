export default function SearchFeedback({ searching, error, retry, empty }: {
  searching: boolean;
  error: boolean;
  retry: () => void;
  empty: string;
}) {
  return (
    <div role={error ? "alert" : "status"} className="px-3 py-7 text-center text-xs text-muted">
      {error ? <><p>Search couldn’t load. Please try again.</p><button type="button" onClick={retry} className="mt-3 rounded-full border border-line px-3 py-1.5 font-medium text-foreground hover:bg-surface-muted">Try again</button></>
        : searching ? "Searching…" : empty}
    </div>
  );
}
