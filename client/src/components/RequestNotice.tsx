export default function RequestNotice({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      <span>{children}</span>
      <button type="button" onClick={onRetry} className="rounded-lg border border-amber-200 px-3 py-1.5 font-semibold hover:bg-amber-100">Try again</button>
    </div>
  );
}
