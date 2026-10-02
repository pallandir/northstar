import type { Crop } from "./capture.js";
import type { JudgedFinding } from "./judge.js";
import { type Loop, describeLoop } from "./loop.js";
import type { Repair } from "./repair.js";
import type { RunRecord } from "./runs.js";

export function describeRun(
  record: RunRecord,
  top: readonly JudgedFinding[],
  repairs: readonly Repair[],
  dir: string,
  loop: Loop,
): string {
  const errors = record.findings.filter((f) => f.severity === "error").length;
  const lines = [
    `Run ${record.id} on ${record.url} (${record.mode} mode, ${record.viewports.join(" and ")}).`,
    `${record.findings.length} findings, ${errors} errors. Saved under ${dir}.`,
  ];
  if (record.truncated.length > 0) {
    lines.push(`The full screenshot was cut at 16000px on: ${record.truncated.join(", ")}.`);
  }
  if (top.length === 0) {
    lines.push(
      "",
      "Clean. Judge what the rules cannot see by eye.",
      describeLoop(loop, record.findings),
    );
    return lines.join("\n");
  }
  lines.push("", `Top ${top.length} by impact:`);
  top.forEach((f, i) => {
    lines.push(
      `${i + 1}. ${f.rule} ${f.severity} (${f.viewports.join("+")}, ${f.region}, confidence ${f.confidence}, ${f.repair === "automatic" ? "safe to fix" : "needs a decision"})`,
      `   ${f.message}`,
      ...(f.evidence.length ? [`   at ${f.evidence.slice(0, 3).join(" ; ")}`] : []),
      `   repair: ${repairs[i]?.modifications[0] ?? ""}`,
    );
  });
  lines.push(
    "",
    `Repair plan saved to ${dir}/${record.id}/repair-plan.json.`,
    describeLoop(loop, record.findings),
  );
  return lines.join("\n");
}

export function imageContent(crop: Crop) {
  return { type: "image" as const, data: crop.data.toString("base64"), mimeType: "image/jpeg" };
}

export function cropCaption(crop: Crop): string {
  return `${crop.viewport} ${crop.region}${crop.truncated ? " (cut at 1500px)" : ""}`;
}
