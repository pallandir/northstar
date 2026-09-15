import type { Rect } from "../types.js";
import { browser } from "./browser.js";

const PADDING_CSS = 16;

export async function captureRegion(
  windowId: number | undefined,
  rect: Rect,
  dpr: number,
): Promise<string> {
  const full = await browser.tabs.captureVisibleTab(windowId ?? browser.windows.WINDOW_ID_CURRENT, {
    format: "png",
  });
  const bitmap = await createImageBitmap(await (await fetch(full)).blob());

  const pad = PADDING_CSS * dpr;
  const sx = Math.max(0, Math.round(rect.x * dpr - pad));
  const sy = Math.max(0, Math.round(rect.y * dpr - pad));
  const sw = Math.min(bitmap.width - sx, Math.round(rect.w * dpr + pad * 2));
  const sh = Math.min(bitmap.height - sy, Math.round(rect.h * dpr + pad * 2));

  const canvas = new OffscreenCanvas(Math.max(1, sw), Math.max(1, sh));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blobToDataUrl(blob);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}
