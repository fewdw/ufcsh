import { useEffect } from "react";

const SITE_NAME = "ufc.sh";
export const SITE_URL = (import.meta.env.VITE_SITE_ORIGIN || "https://ufc.sh").replace(/\/$/, "");
const DEFAULT_DESCRIPTION =
  "Explore UFC fight cards, matchup odds, results, fighter statistics and current rankings in one fast interface.";

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export function useSeo({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  type = "website",
  structuredData,
}: {
  title?: string;
  description?: string;
  path?: string;
  type?: "website" | "profile";
  structuredData?: Record<string, unknown>;
}): void {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : `UFC Events, Odds, Stats & Rankings | ${SITE_NAME}`;
    const canonicalUrl = `${SITE_URL}${path ?? window.location.pathname}`;

    document.title = fullTitle;
    setMeta('meta[name="description"]', "name", "description", description);
    setMeta('meta[property="og:title"]', "property", "og:title", fullTitle);
    setMeta('meta[property="og:description"]', "property", "og:description", description);
    setMeta('meta[property="og:type"]', "property", "og:type", type);
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", fullTitle);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;

    const existing = document.head.querySelector<HTMLScriptElement>("#route-structured-data");
    if (structuredData) {
      const script = existing ?? document.createElement("script");
      script.id = "route-structured-data";
      script.type = "application/ld+json";
      script.textContent = JSON.stringify(structuredData);
      if (!existing) document.head.appendChild(script);
    } else {
      existing?.remove();
    }
  }, [description, path, structuredData, title, type]);
}
