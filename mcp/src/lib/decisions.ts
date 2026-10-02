import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const HEADER = "# Design decisions\n";

export const oneLine = (value: string, max: number): string =>
  value
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .trim()
    .slice(0, max);

async function read(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return HEADER;
    throw err;
  }
}

export async function appendDecision(
  root: string,
  heading: string,
  lines: string[],
): Promise<void> {
  const file = join(root, "design", "decisions.md");
  await mkdir(dirname(file), { recursive: true });
  const entry = ["", `## ${heading}`, "", ...lines, ""].join("\n");
  await writeFile(file, `${(await read(file)).trimEnd()}\n${entry}`);
}
