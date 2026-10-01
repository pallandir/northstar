export const LOOPBACK_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "http://*.localhost/*",
];

export function isLocalUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return (
    host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")
  );
}

export function originOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}
