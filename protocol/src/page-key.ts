const ROUTE_HASH = /^#!?\//;

export function pageKey(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, "") : parsed.pathname;
  const hash = ROUTE_HASH.test(parsed.hash) ? parsed.hash : "";
  return `${parsed.origin}${path || "/"}${hash}`;
}

export function samePage(a: string, b: string): boolean {
  return pageKey(a) === pageKey(b);
}
