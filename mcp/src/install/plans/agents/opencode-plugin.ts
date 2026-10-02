export function opencodePlugin(argv: string[]): string {
  return `import { spawnSync } from "node:child_process";

const ARGV: string[] = ${JSON.stringify(argv)};
const EDIT_TOOLS = new Set(["edit", "write", "patch", "multiedit"]);

export const Northstar = async ({ directory }: { directory: string }) => ({
  "tool.execute.after": async (
    input: { tool: string; args?: Record<string, unknown> },
    output: { output: string },
  ) => {
    if (!EDIT_TOOLS.has(String(input.tool).toLowerCase())) return;
    const file = input.args?.filePath ?? input.args?.file_path ?? input.args?.path;
    if (typeof file !== "string") return;
    const payload = JSON.stringify({ tool_name: "Edit", tool_input: { file_path: file }, cwd: directory });
    const result = spawnSync(ARGV[0], ARGV.slice(1), { input: payload, encoding: "utf8", timeout: 20000 });
    const failure = result.error?.message ?? (result.status === 0 ? "" : result.stderr?.trim() || \`exit \${result.status}\`);
    const feedback = failure ? \`Northstar hook failed: \${failure}\` : result.stdout?.trim();
    if (feedback) output.output = \`\${output.output}\\n\\n\${feedback}\`;
  },
});
`;
}
