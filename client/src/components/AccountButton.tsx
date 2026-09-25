import { User } from "lucide-react";
import ProgressiveImage from "./ProgressiveImage";
import { Link } from "react-router-dom";
import { useAccount } from "../auth";
import { rememberedHandle, useMyProfile } from "../profile";

const CONTROL = "grid h-8 w-8 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 sm:h-9 sm:w-9";

/** The account picture always opens the reader's profile, by its handle as
 *  soon as that is known so the page opens without a redirect. */
export default function AccountButton() {
  const { isLoaded, user, signIn } = useAccount();
  const { identity } = useMyProfile();
  const handle = identity?.handle ?? rememberedHandle(user?.id);
  // The slot is held open while Clerk loads so the header does not shift.
  if (!isLoaded) return <div className="h-8 w-8 shrink-0 sm:h-9 sm:w-9" aria-hidden="true" />;
  if (!user)
    return (
      <button type="button" onClick={signIn} aria-label="Sign in" title="Sign in" className={CONTROL}>
        <User className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  return <Link to={handle ? `/profiles/${encodeURIComponent(handle)}` : "/profiles/me"} aria-label="My profile" title="My profile" className={`${CONTROL} overflow-hidden`}>
    {user.imageUrl
      ? <ProgressiveImage src={user.imageUrl} alt="" className="h-full w-full object-cover" />
      : <User className="h-4 w-4" aria-hidden="true" />}
  </Link>;
}
