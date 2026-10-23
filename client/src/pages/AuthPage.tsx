import { AuthenticateWithRedirectCallback, SignIn, SignUp } from "@clerk/react";
import { Navigate, useLocation } from "react-router-dom";
import { accountsEnabled } from "../auth";

/** Sign-in and sign-up on this site rather than Clerk's hosted account portal,
 *  which has no address of its own here. Social sign-in returns to
 *  `#/sso-callback` on these pages, and the reader lands back where they began. */
export default function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  const location = useLocation();
  if (!accountsEnabled) return <Navigate to="/" replace />;
  if (location.pathname === "/sign-in/callback") {
    const to = sameSite(new URLSearchParams(location.search).get("to"));
    return <AuthenticateWithRedirectCallback signInForceRedirectUrl={to} signUpForceRedirectUrl={to} />;
  }
  return (
    <div className="flex min-h-full items-start justify-center overflow-y-auto px-4 py-10">
      {mode === "sign-in"
        ? <SignIn routing="hash" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
        : <SignUp routing="hash" signInUrl="/sign-in" fallbackRedirectUrl="/" />}
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
