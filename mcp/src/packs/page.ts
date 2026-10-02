import type { Canon, Mode } from "@northstar/canon";
import { z } from "zod";
import type { Crop } from "../page/capture.js";
import { cropCaption, describeRun, imageContent } from "../page/format.js";
import { auditProject, captureProject } from "../page/service.js";
import { VIEWPORT_NAMES, type ViewportName } from "../page/viewports.js";
import type { PackRegistry } from "./registry.js";
import { error, modeSchema } from "./util.js";

const viewportsSchema = z
  .array(z.enum(VIEWPORT_NAMES as [ViewportName, ...ViewportName[]]))
  .min(1)
  .max(4);
const urlSchema = z.string().min(4).max(2000);

function response(body: string, crops: Crop[]) {
  const content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  > = [{ type: "text", text: body }];
  for (const crop of crops) {
    content.push({ type: "text", text: cropCaption(crop) }, imageContent(crop));
  }
  return { content };
}

export function registerPage(registry: PackRegistry, canon: Canon, root: string): void {
  registry.register(
    "page",
    "page_capture",
    {
      description:
        "Open a URL in headless Chrome and return screenshots. By default one image per viewport of the first screen, mobile 390 and desktop 1440. Pass regions (hero, nav, section-1, footer) for crops of those parts. Needs Google Chrome installed, otherwise it says so.",
      inputSchema: {
        url: urlSchema,
        viewports: viewportsSchema.optional(),
        regions: z.array(z.string().max(40)).max(6).optional(),
      },
    },
    async ({ url, viewports, regions }) => {
      try {
        const { crops, notes } = await captureProject({ url, viewports, regions });
        return response(`Captured ${url}.\n${notes.join("\n")}`, crops);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "page",
    "page_audit",
    {
      description:
        "Render a URL in headless Chrome at mobile and desktop, read the real DOM and styles, run the page rules (primary actions, nested cards, contrast, focus, targets, overflow, type, generic hero and more), and return the top findings ranked by impact with crops of the regions they point at. Saves a run under .northstar/design/runs for page_compare. Needs Google Chrome installed.",
      inputSchema: {
        url: urlSchema,
        viewports: viewportsSchema.optional(),
        mode: modeSchema.optional(),
      },
    },
    async ({ url, viewports, mode }) => {
      try {
        const { record, top, crops, dir } = await auditProject({
          root,
          canon,
          url,
          viewports,
          mode: mode as Mode | undefined,
        });
        return response(describeRun(record, top, dir), crops);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );
}
