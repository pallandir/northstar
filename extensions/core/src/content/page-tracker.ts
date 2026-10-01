import { pageKey } from "@northstar/protocol";
import { onNavigate } from "../probe/client.js";

export interface PageTracker {
  key: () => string;
  check: () => boolean;
  stop: () => void;
}

export function createPageTracker(onChange: (key: string) => void): PageTracker {
  let current = pageKey(location.href);

  const check = (): boolean => {
    const next = pageKey(location.href);
    if (next === current) return false;
    current = next;
    onChange(next);
    return true;
  };

  const handler = () => void check();
  const stopNavigate = onNavigate(handler);
  window.addEventListener("popstate", handler);
  window.addEventListener("hashchange", handler);
  window.addEventListener("pageshow", handler);

  return {
    key: () => current,
    check,
    stop: () => {
      stopNavigate();
      window.removeEventListener("popstate", handler);
      window.removeEventListener("hashchange", handler);
      window.removeEventListener("pageshow", handler);
    },
  };
}
