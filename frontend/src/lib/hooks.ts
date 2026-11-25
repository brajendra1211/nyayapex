"use client";

import { useSyncExternalStore } from "react";

export const NAV_SEARCH_EVENT = "nyay:url-change";

function subscribeUrl(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(NAV_SEARCH_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(NAV_SEARCH_EVENT, cb);
  };
}

/** Read a query-string param on the client without useSearchParams (keeps routes static). */
export function useQueryParam(name: string): string | null {
  return useSyncExternalStore(
    subscribeUrl,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

/** Read a data-* attribute on <html> (set by the pre-paint script) and re-render when it changes. */
export function useHtmlData(attr: string, fallback: string): string {
  return useSyncExternalStore(
    (cb) => {
      const o = new MutationObserver(cb);
      o.observe(document.documentElement, { attributes: true, attributeFilter: [`data-${attr}`] });
      return () => o.disconnect();
    },
    () => document.documentElement.dataset[attr] ?? fallback,
    () => fallback,
  );
}
