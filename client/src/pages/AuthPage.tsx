import { SignIn, SignUp } from "@clerk/react";
import { Navigate } from "react-router-dom";
import { accountsEnabled } from "../auth";

/** Sign-in and sign-up on this site rather than Clerk's hosted account portal,
 *  which has no address of its own here. Social sign-in returns to
 *  `#/sso-callback` on these pages, and the reader lands back where they began. */
export default function AuthPage({ mode }: { mode: "sign-in" | "sign-up" }) {
  if (!accountsEnabled) return <Navigate to="/" replace />;
  return (
    <div className="flex min-h-full items-start justify-center overflow-y-auto px-4 py-10">
      {mode === "sign-in"
        ? <SignIn routing="hash" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
        : <SignUp routing="hash" signInUrl="/sign-in" fallbackRedirectUrl="/" />}
    </div>
  );
}
