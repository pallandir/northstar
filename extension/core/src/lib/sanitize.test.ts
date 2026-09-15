import { describe, expect, it } from "vitest";
import { escapeHtml, sanitizeSourcePath } from "./sanitize.js";

describe("escapeHtml", () => {
  it("escapes & < > \" and '", () => {
    expect(escapeHtml("a & <b> \"c\" 'd'")).toBe("a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;");
  });

  it("returns the string unchanged when nothing needs escaping", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });

  it("handles an empty string", () => {
    expect(escapeHtml("")).toBe("");
  });
});

describe("sanitizeSourcePath", () => {
  it("accepts a valid relative path", () => {
    expect(sanitizeSourcePath("src/components/Button.tsx")).toBe("src/components/Button.tsx");
  });

  it("accepts paths with hyphens and underscores", () => {
    expect(sanitizeSourcePath("src/my-component_v2.vue")).toBe("src/my-component_v2.vue");
  });

  it("rejects an empty string", () => {
    expect(sanitizeSourcePath("")).toBeNull();
  });

  it("rejects a path over 1000 characters", () => {
    expect(sanitizeSourcePath("a".repeat(1001))).toBeNull();
  });

  it("accepts a path of exactly 1000 characters", () => {
    expect(sanitizeSourcePath("a".repeat(1000))).toBe("a".repeat(1000));
  });

  it("rejects paths starting with ~", () => {
    expect(sanitizeSourcePath("~/secret")).toBeNull();
  });

  it("rejects Windows drive paths", () => {
    expect(sanitizeSourcePath("C:\\users\\foo\\bar.ts")).toBeNull();
  });

  it("rejects UNC network paths", () => {
    expect(sanitizeSourcePath("\\\\server\\share\\file.ts")).toBeNull();
  });

  it("rejects paths with .. traversal segments", () => {
    expect(sanitizeSourcePath("../../etc/passwd")).toBeNull();
  });

  it("rejects paths where .. appears as one segment amid legitimate dirs", () => {
    expect(sanitizeSourcePath("src/../../../etc/passwd")).toBeNull();
  });

  it("allows legitimate dots in filenames", () => {
    expect(sanitizeSourcePath("src/v1.2/index.test.ts")).toBe("src/v1.2/index.test.ts");
  });

  it("rejects paths containing control characters", () => {
    // Use String.fromCharCode to avoid encoding issues with control chars in source
    const nul = String.fromCharCode(0);
    const esc = String.fromCharCode(27);
    const del = String.fromCharCode(127);
    expect(sanitizeSourcePath(`path${nul}evil`)).toBeNull();
    expect(sanitizeSourcePath(`path${esc}evil`)).toBeNull();
    expect(sanitizeSourcePath(`path${del}evil`)).toBeNull();
  });
});
