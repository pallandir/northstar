import type { Browser, BrowserContext, Page } from "playwright-core";
import { VIEWPORTS, type ViewportName } from "./viewports.js";

export class BrowserUnavailable extends Error {}
class PageError extends Error {}

const IDLE_MS = 120_000;
const NAVIGATION_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;
const MOBILE_MAX_WIDTH = 600;
const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "file:"]);

const SETTLE_SCRIPT = String.raw`(async () => {
  await document.fonts.ready;
  const step = window.innerHeight;
  const end = Math.min(document.documentElement.scrollHeight, step * 25);
  for (let y = 0; y < end; y += step) {
    window.scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  window.scrollTo(0, 0);
})()`;

let launching: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let active = 0;

const firstLine = (error: unknown): string =>
  String((error as Error).message ?? error).split("\n")[0] as string;

async function launch(): Promise<Browser> {
  let engine: typeof import("playwright-core");
  try {
    engine = await import("playwright-core");
  } catch (error) {
    throw new BrowserUnavailable(
      `Northstar cannot use this function, the playwright-core package could not be loaded (${firstLine(error)}). Reinstall @pallandir/northstar.`,
    );
  }
  try {
    const browser = await engine.chromium.launch({ channel: "chrome", headless: true });
    browser.once("disconnected", () => {
      launching = null;
    });
    return browser;
  } catch (error) {
    throw new BrowserUnavailable(
      `Northstar cannot use this function, Google Chrome could not be started (${firstLine(error)}). Install Google Chrome to enable screenshots, page audits and reference search.`,
    );
  }
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (active === 0) void closeBrowser();
  }, IDLE_MS);
  idleTimer.unref();
}

export async function closeBrowser(): Promise<void> {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const pending = launching;
  launching = null;
  if (pending) await (await pending).close();
}

export async function probeChrome(): Promise<void> {
  launching ??= launch();
  try {
    await launching;
  } catch (error) {
    launching = null;
    throw error;
  }
  await closeBrowser();
}

export function assertOpenable(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PageError(
      `${url} is not a valid URL. Pass a full address such as http://localhost:3000.`,
    );
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new PageError(`${parsed.protocol} addresses cannot be opened. Use http, https or file.`);
  }
  return parsed;
}

async function openContext(browser: Browser, viewport: ViewportName): Promise<BrowserContext> {
  const size = VIEWPORTS[viewport];
  const mobile = size.width < MOBILE_MAX_WIDTH;
  return browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: mobile,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    acceptDownloads: false,
  });
}

export async function withPage<T>(
  url: string,
  viewport: ViewportName,
  work: (page: Page) => Promise<T>,
): Promise<T> {
  const target = assertOpenable(url);
  launching ??= launch();
  let browser: Browser;
  try {
    browser = await launching;
  } catch (error) {
    launching = null;
    throw error;
  }
  active += 1;
  const context = await openContext(browser, viewport);
  try {
    const page = await context.newPage();
    try {
      await page.goto(target.href, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      throw new PageError(
        `Could not open ${target.href} (${firstLine(error)}). Start the dev server or fix the address, then try again.`,
      );
    }
    await page.evaluate(SETTLE_SCRIPT);
    await page.waitForTimeout(SETTLE_MS);
    return await work(page);
  } finally {
    await context.close();
    active -= 1;
    scheduleIdleClose();
  }
}
