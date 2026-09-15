import { describe, expect, it } from "vitest";
import type { QueuedRequest } from "../types.js";
import { buildHandoffMarkdown } from "./handoff.js";

function baseRequest(overrides: Partial<QueuedRequest> = {}): QueuedRequest {
  return {
    cid: "q-1",
    queuedAt: Date.now(),
    comment: "Make this a table",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]",
    url: "http://localhost:3000/dashboard",
    metadata: { page: "/dashboard", viewport: { w: 1440, h: 900 }, elementText: "Traffic sources" },
    source: null,
    component: null,
    route: null,
    target: null,
    screenshotDataUrl: null,
    attachScreenshot: false,
    ...overrides,
  };
}

const DATA_URL = "data:image/png;base64,AAAA";

describe("buildHandoffMarkdown", () => {
  it("omits the image when attachScreenshot is false, even if a data url is present", () => {
    const md = buildHandoffMarkdown([
      baseRequest({ attachScreenshot: false, screenshotDataUrl: DATA_URL }),
    ]);
    expect(md).not.toContain("data:image");
  });

  it("includes the image only when attachScreenshot is true", () => {
    const md = buildHandoffMarkdown([
      baseRequest({ attachScreenshot: true, screenshotDataUrl: DATA_URL }),
    ]);
    expect(md).toContain(`![item 1](${DATA_URL})`);
  });

  it("omits the image when attachScreenshot is true but no data url was captured", () => {
    const md = buildHandoffMarkdown([
      baseRequest({ attachScreenshot: true, screenshotDataUrl: null }),
    ]);
    expect(md).not.toContain("data:image");
  });

  it("leads with route, component and source when present", () => {
    const md = buildHandoffMarkdown([
      baseRequest({
        source: {
          path: "src/components/TrafficSources.tsx",
          line: 42,
          column: 8,
          via: "react-fiber",
        },
        component: { stack: [{ name: "TrafficSources" }, { name: "DashboardPage" }] },
        route: {
          pattern: "/users/:id",
          params: { id: "8123" },
          router: "react-router",
          routeFile: "app/routes/users.$id.tsx",
          confidence: "exact",
        },
        target: {
          selector: '[data-testid="traffic"] > article.card',
          tag: "article",
          id: null,
          testId: "traffic",
          role: null,
          ariaLabel: null,
          classes: ["card"],
          attributes: {},
          ownText: "Traffic sources",
          ancestors: [],
          rect: { x: 0, y: 0, w: 10, h: 10 },
          outerHtml: "<article></article>",
        },
      }),
    ]);
    expect(md).toContain("Route: /users/:id (react-router · app/routes/users.$id.tsx)");
    expect(md).toContain("Component: TrafficSources < DashboardPage");
    expect(md).toContain("Source: `src/components/TrafficSources.tsx:42:8` (react-fiber)");
    expect(md).toContain('Selector: `[data-testid="traffic"] > article.card`');
  });

  it("marks an inferred route rather than presenting it as fact", () => {
    const md = buildHandoffMarkdown([
      baseRequest({
        route: {
          pattern: "/users/:id",
          params: null,
          router: "unknown",
          routeFile: null,
          confidence: "inferred",
        },
      }),
    ]);
    expect(md).toContain("_(inferred, not confirmed)_");
  });

  it("falls back to the page path and xpath operator when nothing was probed", () => {
    const md = buildHandoffMarkdown([baseRequest()]);
    expect(md).toContain("Route: /dashboard");
    expect(md).toContain("Element: `/html/body/main[1]`");
  });

  it("is real markdown, not HTML: no tags, YAML front matter at the top", () => {
    const md = buildHandoffMarkdown([baseRequest()]);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).not.toContain("<blockquote>");
    expect(md).not.toContain("<code>");
  });
});
