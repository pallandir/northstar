const LINE_WIDTH = 100;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function isPrimitive(value: Json): boolean {
  return value === null || typeof value !== "object";
}

function print(value: Json, indent: string, prefix: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPrimitive)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (indent.length + prefix.length + inline.length + 1 <= LINE_WIDTH) return inline;
    }
    const inner = `${indent}  `;
    const items = value.map((item) => `${inner}${print(item, inner, "")}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const inner = `${indent}  `;
    const lines = entries.map(([key, item]) => {
      const head = `${JSON.stringify(key)}: `;
      return `${inner}${head}${print(item, inner, head)}`;
    });
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function formatJson(value: Json): string {
  return `${print(value, "", "")}\n`;
}
