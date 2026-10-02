import { resolve } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import { DirectionError, buildDirection } from "../design/direction.js";
import { DIMENSIONS, type Dna, dnaFromSnapshot, dnaSchema } from "../design/dna.js";
import {
  type Intent,
  intentPatchSchema,
  mergeIntent,
  missingFromIntent,
} from "../design/intent.js";
import { DesignStore, type Reference } from "../design/store.js";
import { BrowserUnavailable, withPage } from "../page/browser.js";
import { firstView } from "../page/capture.js";
import { COLLECTOR } from "../page/collector.js";
import type { PageSnapshot } from "../page/snapshot.js";
import { type SearchOutcome, searchProvider } from "../references/harvest.js";
import { fetchImage, mimeOf, readLocalImage } from "../references/image.js";
import { PROVIDERS, PROVIDER_IDS, providerById } from "../references/providers.js";
import { intentTerms, queriesFor } from "../references/queries.js";
import { rankCandidates } from "../references/rank.js";
import type { PackRegistry } from "./registry.js";
import { error, text } from "./util.js";

const DEFAULT_QUERIES = 2;
const MAX_PAGES = 6;
const SHEETS = 3;

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

const image = (data: Buffer, mimeType: string): Content => ({
  type: "image",
  data: data.toString("base64"),
  mimeType,
});

function describe(reference: Reference): string {
  const dna = Object.keys(reference.dna).length ? ` dna ${reference.dnaSource}` : " no dna yet";
  const gives = reference.contributes.length
    ? ` gives ${reference.contributes.join(", ")}`
    : " gives nothing yet";
  return `${reference.id} ${reference.title.slice(0, 60)} (${reference.source},${dna},${gives})`;
}

function requireIntent(store: DesignStore): Intent {
  const intent = store.readIntent();
  const missing = intent
    ? missingFromIntent(intent)
    : ["product.category", "product.surface", "personality"];
  if (!intent || missing.length > 0) {
    throw new Error(
      `The design intent is not complete, missing ${missing.join(", ")}. Read PRODUCT.md, then call design_intent with those fields.`,
    );
  }
  return intent;
}

export function registerDesign(registry: PackRegistry, root: string): void {
  const store = new DesignStore(root);

  registry.register(
    "design",
    "design_intent",
    {
      description:
        "Read or set the design intent: product category and surface, audience, personality, composition, typography character, visual restraint and what to avoid. Pass only the fields to change, they merge into what is saved. With no arguments it returns the saved intent. Reference search follows this intent, so set it first.",
      inputSchema: intentPatchSchema.shape,
    },
    async (patch) => {
      try {
        const current = store.readIntent();
        if (Object.keys(patch).length === 0) {
          if (!current) {
            return text(
              "No design intent yet. Read PRODUCT.md, then call design_intent with product.category, product.surface and personality. Optional: audience, composition, typography.character, visual, avoid.",
            );
          }
          return text(
            `${stringify(current)}\nMissing: ${missingFromIntent(current).join(", ") || "nothing"}.`,
          );
        }
        const merged = mergeIntent(current, patch);
        store.writeIntent(merged);
        const missing = missingFromIntent(merged);
        return text(
          `Saved to ${store.dir}/intent.yaml.\n${stringify(merged)}\nMissing: ${missing.join(", ") || "nothing"}.`,
        );
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "design",
    "references_search",
    {
      description:
        "Search design galleries (Dribbble, Pinterest, Awwwards) in headless Chrome for references that follow the design intent. Returns ranked candidates with ids and one results screenshot per provider. A provider that shows a sign-in wall or finds nothing says so, nothing is bypassed. Add a candidate with references_add. Needs Google Chrome installed.",
      inputSchema: {
        queries: z.array(z.string().min(3).max(120)).min(1).max(4).optional(),
        providers: z.array(z.enum(PROVIDER_IDS)).min(1).max(PROVIDERS.length).optional(),
        limit: z.number().int().min(1).max(20).optional(),
      },
    },
    async ({ queries, providers, limit }) => {
      try {
        const intent = queries ? store.readIntent() : requireIntent(store);
        const wanted =
          queries ??
          queriesFor(intent as Intent)
            .slice(0, DEFAULT_QUERIES)
            .map((q) => q.query);
        const chosen = (providers ?? PROVIDERS.map((p) => p.id)).map(providerById);
        if (wanted.length * chosen.length > MAX_PAGES) {
          return error(
            `That is ${wanted.length * chosen.length} result pages, the limit is ${MAX_PAGES}. Pass fewer queries or providers.`,
          );
        }
        const outcomes: SearchOutcome[] = [];
        for (const provider of chosen) {
          for (const [index, query] of wanted.entries()) {
            outcomes.push(await searchProvider(provider, query, index === 0));
          }
        }
        const ranked = rankCandidates(
          outcomes.flatMap((o) => o.candidates.map((c) => ({ ...c, id: "" }))),
          intent ? intentTerms(intent) : wanted,
          limit,
        ).map((c, i) => ({ ...c, id: `c${i + 1}` }));
        store.writeCandidates(ranked);
        const lines = chosen.map((provider) => {
          const mine = outcomes.filter((o) => o.provider === provider.id);
          const found = mine.reduce((sum, o) => sum + o.found, 0);
          const failed = mine.find((o) => o.failure);
          if (failed) return `- ${provider.id}: failed, ${failed.failure}`;
          if (found === 0)
            return `- ${provider.id}: no results. Pass a page URL or a screenshot file to references_add instead.`;
          const wall = mine.some((o) => o.wall)
            ? " A sign-in panel is shown, so results are partial. Pass a pin URL or a screenshot for more."
            : "";
          return `- ${provider.id}: ${found} images.${wall}`;
        });
        const content: Content[] = [
          {
            type: "text",
            text: [
              `Searched ${outcomes.length} result pages for: ${wanted.join(" | ")}.`,
              ...lines,
              "",
              ranked.length
                ? `Candidates, add with references_add candidate=<id>:\n${ranked.map((c) => `${c.id} ${c.provider} "${c.title.slice(0, 70)}" ${c.link}`).join("\n")}`
                : "No candidates. Add references from URLs or screenshot files with references_add.",
            ].join("\n"),
          },
        ];
        for (const outcome of outcomes.filter((o) => o.shot).slice(0, SHEETS)) {
          content.push(
            { type: "text", text: `${outcome.provider} results` },
            image((outcome.shot as { data: Buffer }).data, "image/jpeg"),
          );
        }
        return { content };
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "design",
    "references_add",
    {
      description:
        "Add one reference and get its image back to look at. Pass exactly one of: candidate (an id from references_search), url (a live page, opened in Chrome, measured and screenshotted), or image (a local file path or an image address). A page gets its Design DNA measured, an image has none until you call references_record.",
      inputSchema: {
        candidate: z.string().max(20).optional(),
        url: z.string().max(2000).optional(),
        image: z.string().max(2000).optional(),
        title: z.string().max(120).optional(),
      },
    },
    async ({ candidate, url, image: source, title }) => {
      try {
        const given = [candidate, url, source].filter((v) => v !== undefined);
        if (given.length !== 1) return error("Pass exactly one of candidate, url or image.");
        const id = store.nextReferenceId();
        const addedAt = new Date().toISOString();
        let reference: Reference;
        let file: { name: string; data: Buffer; mime: string };
        if (candidate !== undefined) {
          const found = store.readCandidates().find((c) => c.id === candidate);
          if (!found)
            return error(`There is no candidate ${candidate}. Run references_search first.`);
          const loaded = await fetchImage(found.image);
          file = {
            name: `image.${loaded.extension}`,
            data: loaded.data,
            mime: mimeOf(loaded.extension),
          };
          reference = {
            id,
            source: found.provider,
            url: found.link,
            title: title ?? found.title,
            addedAt,
            image: file.name,
            dna: {},
            dnaSource: "none",
            contributes: [],
            notes: "",
          };
        } else if (url !== undefined) {
          const shot = await withPage(url, "desktop", async (page) => {
            const snapshot = (await page.evaluate(COLLECTOR)) as PageSnapshot;
            return { snapshot, crop: await firstView(page, "desktop") };
          });
          file = { name: "first-view.jpg", data: shot.crop.data, mime: "image/jpeg" };
          reference = {
            id,
            source: "url",
            url,
            title: title ?? shot.snapshot.title ?? url,
            addedAt,
            image: file.name,
            dna: dnaFromSnapshot(shot.snapshot),
            dnaSource: "measured",
            contributes: [],
            notes: "",
          };
        } else {
          const path = source as string;
          const isRemote = /^https?:\/\//i.test(path);
          const loaded = isRemote ? await fetchImage(path) : readLocalImage(resolve(root, path));
          file = {
            name: `image.${loaded.extension}`,
            data: loaded.data,
            mime: mimeOf(loaded.extension),
          };
          reference = {
            id,
            source: "image",
            url: isRemote ? path : "",
            title: title ?? path.split("/").pop() ?? path,
            addedAt,
            image: file.name,
            dna: {},
            dnaSource: "none",
            contributes: [],
            notes: "",
          };
        }
        store.writeReference(reference, { name: file.name, data: file.data });
        const next =
          reference.dnaSource === "measured"
            ? `Its DNA was measured:\n${JSON.stringify(reference.dna)}\nLook at the image, then call references_record with contributes (${DIMENSIONS.join(", ")}) and any fields the measurement missed.`
            : "Look at the image, then call references_record with the dna you see (composition, typography, geometry, color) and contributes.";
        return {
          content: [
            { type: "text", text: `Added ${describe(reference)}.\n${next}` },
            image(file.data, file.mime),
          ],
        };
      } catch (err) {
        if (err instanceof BrowserUnavailable) return error(err.message);
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "design",
    "references_record",
    {
      description:
        "Record what you see in a reference: Design DNA fields (composition, typography, geometry, color, hierarchy, characteristics) and the dimensions it contributes to the direction (typography, composition, geometry, color, navigation, interaction). Fields merge into what is saved. With only an id it returns the saved record.",
      inputSchema: {
        id: z.string().regex(/^r\d+$/),
        dna: dnaSchema.optional(),
        contributes: z.array(z.enum(DIMENSIONS)).max(DIMENSIONS.length).optional(),
        notes: z.string().max(500).optional(),
      },
    },
    async ({ id, dna, contributes, notes }) => {
      try {
        const current = store.readReference(id);
        if (dna === undefined && contributes === undefined && notes === undefined) {
          return text(`${describe(current)}\n${JSON.stringify(current.dna)}`);
        }
        const merged: Dna = { ...current.dna };
        for (const [group, value] of Object.entries(dna ?? {}) as Array<[keyof Dna, unknown]>) {
          merged[group] = (
            Array.isArray(value)
              ? value
              : { ...(merged[group] as object | undefined), ...(value as object) }
          ) as never;
        }
        const updated: Reference = {
          ...current,
          dna: merged,
          dnaSource: dna ? "recorded" : current.dnaSource,
          contributes: contributes ?? current.contributes,
          notes: notes ?? current.notes,
        };
        store.writeReference(updated);
        return text(`Recorded ${describe(updated)}.`);
      } catch (err) {
        return error((err as Error).message);
      }
    },
  );

  registry.register(
    "design",
    "design_direction",
    {
      description:
        "Build the design direction from the intent and the references that contribute a dimension: typography from one, composition from another, never one site copied. Saves .northstar/design/direction.json, which page_audit then measures the build against. Returns the direction in a few lines with token hints for design_md_propose.",
    },
    async () => {
      try {
        const intent = requireIntent(store);
        const references = store.referenceIds().map((id) => store.readReference(id));
        const direction = buildDirection(intent, references);
        store.writeDirection(direction);
        return text(
          `${direction.summary}\nToken hints: ${JSON.stringify(direction.tokenHints)}\nSaved to ${store.dir}/direction.json.`,
        );
      } catch (err) {
        if (err instanceof DirectionError) return error(err.message);
        return error((err as Error).message);
      }
    },
  );
}
