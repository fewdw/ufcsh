/** Debounced search with cancellation covering both the timer and response body. */
export function startSearch<T>(
  url: string,
  parse: (data: unknown) => T,
  onResult: (data: T) => void,
  onError: () => void,
  { delay = 90, fetcher = fetch }: { delay?: number; fetcher?: typeof fetch } = {},
): () => void {
  const controller = new AbortController();
  const timer = setTimeout(async () => {
    try {
      const response = await fetcher(url, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const data = parse(await response.json());
      if (!controller.signal.aborted) onResult(data);
    } catch {
      if (!controller.signal.aborted) onError();
    }
  }, delay);
  return () => { clearTimeout(timer); controller.abort(); };
}
