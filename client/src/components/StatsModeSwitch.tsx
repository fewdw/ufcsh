import { Link, useLocation } from "react-router-dom";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

/**
 * Charts and Labs are two ways of reading the same fight records, so they share
 * one switch rather than two entries in the header. Both are real routes, so a
 * Labs population stays linkable and the Back button behaves.
 */
export default function StatsModeSwitch() {
  const { pathname } = useLocation();
  const onLabs = pathname.startsWith("/labs");
  const links = [
    { to: "/stats", label: "Charts", active: !onLabs },
    { to: "/labs", label: "Labs", active: onLabs },
  ];
  return (
    <div className={segmentedGroup} aria-label="Statistics view">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          aria-current={link.active ? "page" : undefined}
          className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${link.active ? segmentedSelected : segmentedIdle}`}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}
