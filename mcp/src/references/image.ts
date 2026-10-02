import { readFileSync } from "node:fs";
import { extname } from "node:path";

const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const LOCAL: Record<string, string> = {
  ".png": "png",
  ".jpg": "jpg",
  ".jpeg": "jpg",
  ".webp": "webp",
  ".gif": "gif",
};

export interface LoadedImage {
  data: Buffer;
  extension: string;
}

export async function fetchImage(url: string): Promise<LoadedImage> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${url} is not an http or https address.`);
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok)
    throw new Error(`${url} answered ${response.status}. Pass another image or a screenshot file.`);
  const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
  const extension = EXTENSIONS[type];
  if (!extension)
    throw new Error(`${url} is ${type || "an unknown type"}, not a png, jpeg, webp or gif image.`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > MAX_BYTES)
    throw new Error(`${url} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  return { data, extension };
}

export function readLocalImage(path: string): LoadedImage {
  const extension = LOCAL[extname(path).toLowerCase()];
  if (!extension) throw new Error(`${path} is not a png, jpeg, webp or gif file.`);
  const data = readFileSync(path);
  if (data.length > MAX_BYTES)
    throw new Error(`${path} is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
  return { data, extension };
}

export const mimeOf = (extension: string): string =>
  extension === "jpg" ? "image/jpeg" : `image/${extension}`;
