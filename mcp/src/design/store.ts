import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import { DIMENSIONS, dnaSchema } from "./dna.js";
import { type Intent, intentSchema } from "./intent.js";

const dimensionSchema = z.enum(DIMENSIONS);

const referenceSchema = z.object({
  id: z.string(),
  source: z.string(),
  url: z.string(),
  title: z.string(),
  addedAt: z.string(),
  image: z.string().nullable(),
  dna: dnaSchema,
  dnaSource: z.enum(["measured", "recorded", "none"]),
  contributes: z.array(dimensionSchema),
  notes: z.string().max(500),
});

export type Reference = z.infer<typeof referenceSchema>;

const candidateSchema = z.object({
  id: z.string(),
  provider: z.string(),
  query: z.string(),
  title: z.string(),
  image: z.string(),
  link: z.string(),
});

export type Candidate = z.infer<typeof candidateSchema>;

const directionSchema = z.object({
  createdAt: z.string(),
  intent: intentSchema,
  dna: dnaSchema,
  sources: z.record(z.array(z.string())),
  avoid: z.array(z.string()),
  tokenHints: z.record(z.string()),
  summary: z.string(),
});

export type Direction = z.infer<typeof directionSchema>;

function readJson<S extends z.ZodTypeAny>(
  file: string,
  schema: S,
  what: string,
): z.infer<S> | undefined {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(
      `${file} is not a valid ${what} (${parsed.error.issues[0]?.message}). Fix or delete it.`,
    );
  }
  return parsed.data;
}

export class DesignStore {
  readonly dir: string;

  constructor(root: string) {
    this.dir = join(root, ".northstar", "design");
  }

  private get intentFile(): string {
    return join(this.dir, "intent.yaml");
  }

  private get directionFile(): string {
    return join(this.dir, "direction.json");
  }

  private get candidatesFile(): string {
    return join(this.dir, "references", "candidates.json");
  }

  referenceDir(id: string): string {
    return join(this.dir, "references", id);
  }

  readIntent(): Intent | undefined {
    let raw: string;
    try {
      raw = readFileSync(this.intentFile, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    const parsed = intentSchema.safeParse(parse(raw));
    if (!parsed.success) {
      throw new Error(
        `${this.intentFile} is not a valid design intent (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}). Fix it or delete it.`,
      );
    }
    return parsed.data;
  }

  writeIntent(intent: Intent): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.intentFile, stringify(intent));
  }

  writeCandidates(candidates: Candidate[]): void {
    mkdirSync(join(this.dir, "references"), { recursive: true });
    writeFileSync(this.candidatesFile, JSON.stringify(candidates));
  }

  readCandidates(): Candidate[] {
    return readJson(this.candidatesFile, z.array(candidateSchema), "candidate list") ?? [];
  }

  nextReferenceId(): string {
    const numbers = this.referenceIds().map((id) => Number(id.slice(1)));
    return `r${Math.max(0, ...numbers) + 1}`;
  }

  referenceIds(): string[] {
    try {
      return readdirSync(join(this.dir, "references"), { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^r\d+$/.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  writeReference(reference: Reference, image?: { name: string; data: Buffer }): void {
    const dir = this.referenceDir(reference.id);
    mkdirSync(dir, { recursive: true });
    if (image) writeFileSync(join(dir, image.name), image.data);
    writeFileSync(join(dir, "reference.json"), `${JSON.stringify(reference, null, 2)}\n`);
  }

  readReference(id: string): Reference {
    const found = readJson(
      join(this.referenceDir(id), "reference.json"),
      referenceSchema,
      "reference",
    );
    if (!found) {
      throw new Error(
        `There is no reference ${id}. Known references: ${this.referenceIds().join(", ") || "none yet"}.`,
      );
    }
    return found;
  }

  readImage(reference: Reference): Buffer | undefined {
    return reference.image
      ? readFileSync(join(this.referenceDir(reference.id), reference.image))
      : undefined;
  }

  removeReference(id: string): void {
    rmSync(this.referenceDir(id), { recursive: true, force: true });
  }

  writeDirection(direction: Direction): void {
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.directionFile, `${JSON.stringify(direction, null, 2)}\n`);
  }

  readDirection(): Direction | undefined {
    return readJson(this.directionFile, directionSchema, "direction");
  }
}
