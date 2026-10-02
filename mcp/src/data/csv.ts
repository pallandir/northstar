export function parseCsv(input: string): Array<Record<string, string>> {
  const text = input.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      field = "";
      if (record.some((value) => value !== "")) records.push(record);
      record = [];
    } else {
      field += char;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    if (record.some((value) => value !== "")) records.push(record);
  }

  const [header, ...rows] = records;
  if (!header) return [];
  return rows.map((values) =>
    Object.fromEntries(header.map((name, index) => [name.trim(), (values[index] ?? "").trim()])),
  );
}
