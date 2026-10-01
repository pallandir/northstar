import { randomUUID } from "node:crypto";
import type { Draft } from "../src/types.js";

export function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    cid: randomUUID(),
    comment: "Fix padding",
    operation: { type: "comment", property: null, from: null, to: null },
    operator: "/html/body/main[1]",
    url: "http://localhost:3000/",
    metadata: { page: "/", viewport: { w: 1440, h: 900 }, elementText: "hi" },
    ...overrides,
  };
}
