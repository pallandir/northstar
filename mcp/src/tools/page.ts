import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Canon, Mode } from "@northstar/canon";
import { z } from "zod";
import type { Crop } from "../page/capture.js";
import { compareRuns, describeComparison } from "../page/compare.js";
import { cropCaption, describeRun, imageContent } from "../page/format.js";
import { LoopStore } from "../page/loop.js";
import { auditProject, captureProject } from "../page/service.js";
import { VIEWPORT_NAMES, type ViewportName } from "../page/viewports.js";
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

export function registerPage(server: McpServer, canon: Canon, root: string): void {
  server.registerTool(
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

  server.registerTool(
    "page_audit",
    {
      description:
        "Render a URL in headless Chrome at mobile and desktop, read the real DOM and styles, run the page rules (primary actions, nested cards, contrast, focus, targets, overflow, type, generic hero and more), and return the top findings ranked by impact with crops of the regions they point at. Saves a run and a repair plan under .northstar/design/runs, and tracks a bounded audit loop of four audits per page, so repair, audit again and page_compare until it says stop. Contrast is measured from the rendered pixels where the page is unclear, so treat a surprising finding, such as a product mock-up inside the page, as an observation to check in the crops. Needs Google Chrome installed.",
      inputSchema: {
        url: urlSchema,
        viewports: viewportsSchema.optional(),
        mode: modeSchema.optional(),
        restart: z.boolean().optional(),
      },
    },
    async ({ url, viewports, mode, restart }) => {
      try {
        const { record, top, repairs, crops, dir, loop } = await auditProject({
          root,
          canon,
          url,
          viewports,
          mode: mode as Mode | undefined,
          restart,
        });
        return response(describeRun(record, top, repairs, dir, loop), crops);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  server.registerTool(
    "page_compare",
    {
      description:
        "Compare two saved audit runs of the same page: findings resolved and introduced, the share of pixels that changed per viewport, and which regions moved. The verdict is regressed when a repair introduced a higher severity finding than it resolved. Pass the run ids from page_audit, or leave both out to compare the first and the latest run of the current loop.",
      inputSchema: { before: z.string().max(40).optional(), after: z.string().max(40).optional() },
    },
    async ({ before, after }) => {
      try {
        const loop = new LoopStore(root).read();
        const first = before ?? loop?.runs[0];
        const last = after ?? loop?.runs.at(-1);
        if (!first || !last || first === last) {
          return error("There are not two runs to compare yet. Audit, repair, then audit again.");
        }
        return {
          content: [
            {
              type: "text" as const,
              text: describeComparison(await compareRuns(root, first, last)),
            },
          ],
        };
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );
}
