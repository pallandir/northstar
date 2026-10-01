import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

interface Verb {
  name: string;
  topic: string;
  title: string;
  task: string;
}

export const VERBS: Verb[] = [
  {
    name: "brief",
    topic: "brief",
    title: "Brief",
    task: "Capture the audience, the primary job, success and constraints, and write PRODUCT.md.",
  },
  {
    name: "direct",
    topic: "direction",
    title: "Direction",
    task: "Choose the mode, propose two or three named directions grounded in the subject, and record the pick.",
  },
  {
    name: "system",
    topic: "system",
    title: "System",
    task: "Build or normalise DESIGN.md with tokens, chosen libraries and component states.",
  },
  {
    name: "compose",
    topic: "compose",
    title: "Compose",
    task: "Plan the layout first, review the plan against the brief, then build library first from the tokens.",
  },
  {
    name: "critique",
    topic: "critique",
    title: "Critique",
    task: "Review the built result with screenshots, score it against the rubric and rank the findings.",
  },
  {
    name: "polish",
    topic: "polish",
    title: "Polish",
    task: "Finish states, copy, motion, accessibility and responsive behaviour, then clear detector errors.",
  },
  {
    name: "adapt",
    topic: "adapt",
    title: "Adapt",
    task: "Carry the existing design to a new target without breaking DESIGN.md.",
  },
  {
    name: "modernise",
    topic: "modernise",
    title: "Modernise",
    task: "Derive a brief and a system from the existing code, then propose safe incremental changes.",
  },
];

function verbText(verb: Verb, request?: string): string {
  const lines = [
    `Run the Northstar ${verb.title} stage. ${verb.task}`,
    "DESIGN.md comes first: do not create or edit UI files until it exists and is valid.",
    `Read northstar://canon/references/${verb.topic} first, or references/${verb.topic}.md from the northstar skill. If the northstar_context tool is available, call it before anything else.`,
    "Ask at most 3 questions per turn, each with a recommended default. Never ask what the repo can answer. Use libraries instead of hand rolling icons, fonts, overlays or primitives.",
  ];
  if (request) lines.push(`Request: ${request}`);
  return lines.join("\n\n");
}

export function registerPrompts(server: McpServer): void {
  for (const verb of VERBS) {
    server.registerPrompt(
      verb.name,
      {
        title: `Northstar ${verb.title}`,
        description: verb.task,
        argsSchema: { request: z.string().max(2000).optional() },
      },
      ({ request }) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: verbText(verb, request) },
          },
        ],
      }),
    );
  }
}
