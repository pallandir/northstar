import { spawnSync } from "node:child_process";

const ARGV: string[] = ["node","-e","const cp=require('child_process');const a=process.argv.slice(1);const npx=a[0]==='npx';if(npx===false&&require('fs').existsSync(a[0])===false){console.error('Northstar is not installed at '+a[0]+'. Run northstar install again.');process.exit(1)}const r=npx?cp.spawnSync('npx',a.slice(1),{stdio:'inherit',shell:process.platform==='win32'}):cp.spawnSync(process.execPath,a,{stdio:'inherit'});if(r.error||r.status===null){console.error('Northstar hook failed: '+(r.error?r.error.message:'killed by signal')+'. Run northstar doctor.');process.exit(1)}process.exit(r.status)","npx","-y","@pallandir/northstar@3.0.0","hook","post-edit","--agent","opencode"];
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
    const failure = result.error?.message ?? (result.status === 0 ? "" : result.stderr?.trim() || `exit ${result.status}`);
    const feedback = failure ? `Northstar hook failed: ${failure}` : result.stdout?.trim();
    if (feedback) output.output = `${output.output}\n\n${feedback}`;
  },
});
