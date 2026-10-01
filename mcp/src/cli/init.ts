import { scaffold } from "../lib/scaffold.js";

export async function init(args: string[]): Promise<number> {
  const force = args.includes("--force");
  const dir =
    args.find((arg) => !arg.startsWith("--")) ?? process.env.NORTHSTAR_ROOT ?? process.cwd();
  const { created, skipped } = scaffold(dir, force);
  for (const path of created) process.stdout.write(`created ${path}\n`);
  for (const path of skipped) process.stdout.write(`kept ${path} (use --force to overwrite)\n`);
  return 0;
}
