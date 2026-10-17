import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Check, CircleHelp, Copy, MonitorPlay, X } from "lucide-react";
import { BUTTON_QUIET, CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";

// The overlay's own chunk, loaded only when the dialog opens.
const OverlayPreview = lazy(() => import("../pages/OverlayPage").then((module) => ({ default: module.OverlayPreview })));

/** One address to copy, with what it does. */
function Address({ label, hint, url }: { label: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };
  return (
    <div>
      <p className="text-xs font-medium text-zinc-700">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 py-1 pl-3 pr-1">
        <code className="min-w-0 flex-1 truncate text-xs text-zinc-900">{url}</code>
        <button type="button" onClick={copy} aria-label={`Copy ${label}`} className={`${BUTTON_QUIET} flex items-center gap-1 !px-2 !py-1 text-xs`}>
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{hint}</p>
    </div>
  );
}

/** How a streamer puts the fans' live scorecard on screen: one click copies
 *  the overlay's address (the one that follows the card, for tonight's bouts),
 *  and the ? beside it opens both addresses, a preview and the OBS steps. */
export default function OverlayButton({ fightId, followsCard }: { fightId: string; followsCard: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    else if (!open && node?.open) node.close();
  }, [open]);
  const origin = window.location.origin;
  const url = followsCard ? `${origin}/overlay` : `${origin}/overlay/${fightId}`;
  const copy = () => {
    void navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => setOpen(true));
  };
  return (
    <>
      <span className="flex items-center gap-0.5">
        <button type="button" onClick={copy} title={`${url} · OBS → Sources → Browser, 560 × 160`}
          className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <MonitorPlay className="h-3.5 w-3.5" aria-hidden="true" />}
          {copied ? "Copied" : <><span className="max-sm:hidden">Copy OBS URL for your stream</span><span className="sm:hidden">OBS URL</span></>}
        </button>
        <button type="button" onClick={() => setOpen(true)} aria-label="Stream overlay setup" title="Preview and setup"
          className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </span>
      <dialog ref={dialog} onClose={() => setOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        className="search-dialog fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100%-2rem))] max-w-none overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl">
        {open ? <>
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
            <div>
              <h2 className={DIALOG_TITLE}>Stream overlay</h2>
              <p className="mt-0.5 text-xs text-zinc-500">Put the fans' live scorecard on your stream.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className={`-mr-2 ${CLOSE_BUTTON}`}>
              <X className={CLOSE_ICON} aria-hidden="true" />
            </button>
          </div>
          <div className="space-y-4 px-5 py-5">
            {/* What appears on stream, over a checkerboard: the card is all
                there is, everything around it is transparent. */}
            <div className="flex h-28 items-start overflow-hidden rounded-xl border border-zinc-200 p-2"
              style={{ background: "repeating-conic-gradient(#d4d4d8 0 25%, #f4f4f5 0 50%) 0 0 / 16px 16px" }}>
              {/* Shown smaller so the whole card fits a phone. */}
              <Suspense fallback={null}><OverlayPreview fightId={fightId} /></Suspense>
            </div>
            <Address label="Follows the card" url={`${origin}/overlay`}
              hint="Moves to each bout as it starts: set it up once for the whole card." />
            <Address label="This fight only" url={`${origin}/overlay/${fightId}`}
              hint="Stays on this bout." />
            <div className="rounded-lg bg-zinc-50 px-3 py-2.5 text-xs leading-5 text-zinc-600">
              <p className="font-medium text-zinc-900">In OBS</p>
              <p>Sources → + → <strong>Browser</strong>. Paste an address, set width <strong>560</strong> and height <strong>160</strong>. It refreshes itself every few seconds.</p>
              <p className="mt-1">Add <code>?theme=light</code> for a light card, or <code>?scale=1.5</code> to make it bigger (raise the source size to match). The round being fought shows ••• until it ends.</p>
            </div>
          </div>
        </> : null}
      </dialog>
    </>
  );
}
