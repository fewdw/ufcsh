import { useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { accountsEnabled, useClerkInstance } from "../auth";

/** Sign-in and sign-up on this site rather than Clerk's hosted account portal,
 *  which has no address of its own here. Social sign-in returns to
 *  `#/sso-callback` on these pages, and the reader lands back where they began.
 *  Clerk is loaded beside the app (auth.tsx), so its forms are mounted from
 *  the instance rather than as components. */
export default function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const location = useLocation();
  const { clerk, unavailable } = useClerkInstance();
  const form = useRef<HTMLDivElement>(null);
  const handled = useRef(false);
  const callback = location.pathname === "/sign-in/callback";
  const to = callback ? sameSite(new URLSearchParams(location.search).get("to")) : "/";
  useEffect(() => {
    if (!clerk) return;
    if (callback) {
      if (handled.current) return;
      handled.current = true;
      void clerk.handleRedirectCallback({ signInForceRedirectUrl: to, signUpForceRedirectUrl: to });
      return;
    }
    const node = form.current;
    if (!node) return;
    if (mode === "sign-in") {
      clerk.mountSignIn(node, { routing: "hash", signUpUrl: "/sign-up", fallbackRedirectUrl: "/" });
      return () => clerk.unmountSignIn(node);
    }
    clerk.mountSignUp(node, { routing: "hash", signInUrl: "/sign-in", fallbackRedirectUrl: "/" });
    return () => clerk.unmountSignUp(node);
  }, [clerk, callback, mode, to]);
  if (!accountsEnabled) return <Navigate to="/" replace />;
  if (unavailable) return <p className="px-4 py-10 text-center text-sm text-zinc-500">Sign-in could not load. Reload the page to try again.</p>;
  if (callback) return null;
  return (
    <div className="flex min-h-full items-start justify-center overflow-y-auto px-4 py-10">
      <div ref={form} />
    </div>
  );
}

/** Back from Google without Clerk's window (`signInWithGoogle` in auth.tsx):
 *  only to a page on this site. */
function sameSite(to: string | null): string {
  try {
    const url = new URL(to ?? "/", window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search + url.hash : "/";
  } catch { return "/"; }
}
