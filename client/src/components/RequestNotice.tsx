export default function RequestNotice({ children, onRetry }: { children: React.ReactNode; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning-line bg-warning-subtle px-4 py-3 text-xs text-warning">
      <span>{children}</span>
      <button type="button" onClick={onRetry} className="rounded-lg border border-warning-line px-3 py-1.5 font-medium hover:bg-warning-subtle">Try again</button>
    </div>
  );
}
