export function opencodePlugin(command: string): string {
  return `import { spawnSync } from "node:child_process";

const COMMAND = ${JSON.stringify(command)};
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
    const result = spawnSync("sh", ["-c", COMMAND], { input: payload, encoding: "utf8", timeout: 20000 });
    const feedback = result.stdout?.trim();
    if (feedback) output.output = \`\${output.output}\\n\\n\${feedback}\`;
  },
});
`;
}
