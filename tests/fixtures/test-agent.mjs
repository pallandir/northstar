import { appendFileSync } from "node:fs";

const log = process.env.TEST_AGENT_LOG;
const mode = process.argv[2] ?? "idle";

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
process.stdout.write("Test Agent\n");

if (mode === "prompt") {
  process.stdout.write("Overwrite the file? (y/n)");
} else {
  process.stdout.write("> ");
}

let typed = "";
process.stdin.on("data", (chunk) => {
  for (const char of chunk) {
    if (mode === "prompt") continue;
    if (char === "\r") {
      if (log) appendFileSync(log, `${typed}\n`);
      process.stdout.write(`\nReceived: ${typed.length} characters\n> `);
      typed = "";
    } else {
      typed += char;
      process.stdout.write(char);
    }
  }
});

if (mode === "busy") {
  setInterval(() => process.stdout.write("."), 20);
}
