import { User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "../auth";

const CONTROL = "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900";
const ITEM = "block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900";

/** Sign in and out from anywhere, beside the theme switch. */
export default function AccountButton() {
  const { isLoaded, user, signIn, signOut, manage } = useAccount();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => { if (!menu.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", key); };
  }, [open]);
  // The slot is held open while Clerk loads so the header does not shift.
  if (!isLoaded) return <div className="h-9 w-9 shrink-0" aria-hidden="true" />;
  if (!user)
    return (
      <button type="button" onClick={signIn} aria-label="Sign in" title="Sign in" className={CONTROL}>
        <User className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  return (
    <div className="relative" ref={menu}>
      <button type="button" onClick={() => setOpen(value => !value)} aria-haspopup="menu" aria-expanded={open}
        aria-label="Account" title={user.primaryEmailAddress?.emailAddress ?? "Account"}
        className={`${CONTROL} overflow-hidden`}>
        {user.imageUrl
          ? <img src={user.imageUrl} alt="" className="h-full w-full object-cover" />
          : <User className="h-4 w-4" aria-hidden="true" />}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-11 z-40 w-52 rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
          <p className="truncate px-3 py-2 text-[11px] text-zinc-400">{user.primaryEmailAddress?.emailAddress ?? user.username ?? "Signed in"}</p>
          {/* Every fight this reader has scored, at the same public address any
              other reader can open. */}
          <Link to="/profiles/me?tab=scorecards" role="menuitem" className={ITEM} onClick={() => setOpen(false)}>My scorecards</Link>
          <button type="button" role="menuitem" className={ITEM} onClick={() => { setOpen(false); manage(); }}>Manage account</button>
          <button type="button" role="menuitem" className={ITEM} onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
        </div>
      ) : null}
    </div>
  );
}
