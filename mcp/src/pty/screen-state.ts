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

const BOX_EDGE = /^[\s│|┃║]+|[\s│|┃║]+$/g;
const RULE_LINE = /^[─━═╭╮╰╯┌┐└┘├┤\s-]*$/;
const HINT_LINE = /^(esc\b|enter\b|tab\b|ctrl\b|press\b|use\b|[↑↓←→])/i;

function content(line: string): string {
  return line.replace(BOX_EDGE, "");
}

function isChrome(line: string): boolean {
  return RULE_LINE.test(line) || HINT_LINE.test(line);
}

export function awaitingAnswer(lines: string[]): boolean {
  const body = lines.map(content);
  let end = body.length - 1;
  while (end >= 0 && isChrome(body[end] as string)) end -= 1;
  const last = body[end];
  if (last === undefined) return false;
  if (CONFIRM_PROMPT.test(last)) return true;
  let selected = false;
  let options = 0;
  for (let i = end; i >= 0; i -= 1) {
    const match = CHOICE_OPTION.exec(body[i] as string);
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
