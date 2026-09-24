import { Component } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { recoverRouteImport } from "../routeRecovery";
import { BUTTON_PRIMARY } from "../ui";

export default class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Accessing sessionStorage itself can throw when browser storage is blocked.
    try {
      recoverRouteImport(error, import.meta.url, window.sessionStorage, () => window.location.reload());
    } catch { /* The recovery controls below remain available. */ }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-5 text-sm text-zinc-500">
        <p>This page couldn’t load. Please try reloading it.</p>
        <button type="button" onClick={() => window.location.reload()} className={BUTTON_PRIMARY}>Reload page</button>
        <Link to="/" className="font-semibold text-zinc-900 underline">Back to events</Link>
      </div>
    );
  }
}
