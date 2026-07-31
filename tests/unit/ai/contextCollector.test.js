import { describe, it, expect } from "vitest";
import { ContextCollector } from "ai/contextCollector";

describe("ContextCollector", () => {
  it("creates with default root dir", () => {
    const collector = new ContextCollector();
    expect(collector.rootDir).toBe("/public");
  });

  it("creates with custom root dir", () => {
    const collector = new ContextCollector("/tmp");
    expect(collector.rootDir).toBe("/tmp");
  });

  it("collects a single file", () => {
    const collector = new ContextCollector("/tmp");
    const result = collector.collect("/tmp");
    expect(result).toHaveProperty("files");
    expect(result).toHaveProperty("tree");
  });

  it("returns empty for nonexistent path", () => {
    const collector = new ContextCollector("/nonexistent");
    const result = collector.collect("/nonexistent/file.js");
    expect(result.files).toEqual([]);
  });

  it("formats context with tree and files", () => {
    const collector = new ContextCollector();
    const context = {
      tree: "src/\n  index.js",
      files: [{ relativePath: "src/index.js", content: "console.log('hi');" }],
    };
    const formatted = collector.formatContext(context);
    expect(formatted).toContain("Project structure:");
    expect(formatted).toContain("src/index.js");
  });

  it("formats context with empty tree", () => {
    const collector = new ContextCollector();
    const formatted = collector.formatContext({ tree: "", files: [] });
    expect(formatted).toBe("");
  });
});
