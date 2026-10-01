import { spawnSync } from "node:child_process";

const COMMAND = "sh -c '(command -v northstar >/dev/null 2>&1 && northstar hook post-edit --agent opencode) || npx -y @pallandir/northstar@2.1.0 hook post-edit --agent opencode || true'";
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
    if (feedback) output.output = `${output.output}\n\n${feedback}`;
  },
});
