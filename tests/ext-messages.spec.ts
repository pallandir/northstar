import { describe, expect, it } from "vitest";
import { parseMessage } from "../extensions/core/src/messages.js";

describe("copy-line message", () => {
  it("is accepted with no payload", () => {
    expect(parseMessage({ type: "copy-line" })).toEqual({ type: "copy-line" });
  });

  it("refuses an unknown message type", () => {
    expect(() => parseMessage({ type: "quick-run", agent: "claude" })).toThrow();
  });
});
