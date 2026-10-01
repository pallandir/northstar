const TAIL_LINES = 20;
const CHOICE_OPTION = /^\s*([❯>›])?\s*\d+[.)]\s/;
const CONFIRM_PROMPT = /\((?:y\/n|yes\/no)\)|\[y\/n\]/i;
const INPUT_LINE = /^[\s│|┃]*[❯>›]\s?(.*?)[\s│|┃]*$/;
const INPUT_PLACEHOLDER = /^(try "|ask |type |send a message|plan, search)/i;
const INPUT_SCAN_LINES = 8;

export function tail(lines: string[]): string[] {
  return lines
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .slice(-TAIL_LINES);
}

export function awaitingAnswer(lines: string[]): boolean {
  const last = lines[lines.length - 1];
  if (last === undefined) return false;
  if (CONFIRM_PROMPT.test(last)) return true;
  let selected = false;
  let options = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const match = CHOICE_OPTION.exec(lines[i] as string);
    if (!match) break;
    options += 1;
    if (match[1]) selected = true;
  }
  return options > 0 && selected;
}

export function typedInput(lines: string[]): string | null {
  for (const line of lines.slice(-INPUT_SCAN_LINES).reverse()) {
    const match = INPUT_LINE.exec(line);
    if (!match) continue;
    const content = (match[1] ?? "").trim();
    return INPUT_PLACEHOLDER.test(content) ? "" : content;
  }
  return null;
}
