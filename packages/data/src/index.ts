import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Bm25Index } from "./bm25.js";
import {
  DOMAINS,
  type Domain,
  type Manifest,
  type Mode,
  type Row,
  manifestSchema,
  rowSchema,
} from "./schema.js";

export * from "./schema.js";
export { Bm25Index, tokenize } from "./bm25.js";

export interface DesignData {
  root: string;
  manifest: Manifest;
  rows: Record<Domain, Row[]>;
}

export function defaultDataRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "json");
}

export function loadData(root: string = defaultDataRoot()): DesignData {
  const rows = {} as Record<Domain, Row[]>;
  for (const domain of DOMAINS) {
    const path = join(root, `${domain}.json`);
    if (!existsSync(path)) {
      throw new Error(
        `design data file ${path} is missing, reinstall the package or run npm run port`,
      );
    }
    rows[domain] = z.array(rowSchema).parse(JSON.parse(readFileSync(path, "utf8")));
  }
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")),
  );
  return { root, manifest, rows };
}

const indexes = new WeakMap<DesignData, Map<Domain, Bm25Index>>();

function indexFor(data: DesignData, domain: Domain): Bm25Index {
  let perData = indexes.get(data);
  if (!perData) {
    perData = new Map();
    indexes.set(data, perData);
  }
  let index = perData.get(domain);
  if (!index) {
    index = new Bm25Index(data.rows[domain]);
    perData.set(domain, index);
  }
  return index;
}

export interface SearchOptions {
  domain: Domain;
  query: string;
  mode?: Mode;
  limit?: number;
}

export function search(data: DesignData, options: SearchOptions): Row[] {
  const { domain, query, mode, limit = 5 } = options;
  const accept = (row: Row) => !mode || row.modes.length === 0 || row.modes.includes(mode);
  return indexFor(data, domain).search(query, Math.min(limit, 20), accept);
}

export function getRow(data: DesignData, domain: Domain, id: string): Row | undefined {
  return data.rows[domain].find((row) => row.id === id);
}
