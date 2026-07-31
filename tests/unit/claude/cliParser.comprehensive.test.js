import { describe, it, expect, beforeEach } from "vitest";
import {
  parseCliOutput,
  parseDiffContent,
  createStreamingParser,
} from "lib/claude/cliParser.js";

describe("cliParser — Comprehensive Test Suite", () => {
  // ── Plain text parsing ────────────────────────────────────────
  describe("plain text", () => {
    it("parses a single line of text", () => {
      const result = parseCliOutput("Hello world");
      expect(result).toEqual([{ type: "text", content: "Hello world" }]);
    });

    it("parses multi-line text", () => {
      const result = parseCliOutput("Line 1\nLine 2\nLine 3");
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("Line 1\nLine 2\nLine 3");
    });

    it("trims whitespace from text", () => {
      const result = parseCliOutput("  hello  ");
      expect(result[0].content).toBe("hello");
    });

    it("handles empty input", () => {
      expect(parseCliOutput("")).toEqual([]);
    });

    it("handles null/undefined input gracefully", () => {
      expect(parseCliOutput(null)).toEqual([]);
      expect(parseCliOutput(undefined)).toEqual([]);
    });

    it("handles output with only whitespace", () => {
      expect(parseCliOutput("   \n  \n  ")).toEqual([]);
    });

    it("preserves markdown formatting in text", () => {
      const md = "# Heading\n\n**Bold** and *italic*\n\n- item 1\n- item 2";
      const result = parseCliOutput(md);
      expect(result[0].content).toContain("# Heading");
      expect(result[0].content).toContain("**Bold**");
    });

    it("handles very long text output", () => {
      const longText = "x".repeat(50000);
      const result = parseCliOutput(longText);
      expect(result).toHaveLength(1);
      expect(result[0].content).toHaveLength(50000);
    });
  });

  // ── Tool call blocks ──────────────────────────────────────────
  describe("tool call blocks", () => {
    it("parses a simple read_file tool call", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/home/test.js"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "read_file",
        input: { path: "/home/test.js" },
      });
    });

    it("parses a write_file tool call", () => {
      const input = `<tool_use>
<name>write_file</name>
<input>{"path": "/home/output.js", "content": "console.log('hi');"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "write_file",
      });
      expect(result[0].input.path).toBe("/home/output.js");
    });

    it("parses an Edit tool call", () => {
      const input = `<tool_use>
<name>Edit</name>
<input>{"file_path": "/home/a.js", "old_string": "foo", "new_string": "bar"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "Edit",
        input: {
          file_path: "/home/a.js",
          old_string: "foo",
          new_string: "bar",
        },
      });
    });

    it("parses a Bash tool call", () => {
      const input = `<tool_use>
<name>Bash</name>
<input>{"command": "npm test", "description": "Run tests"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "Bash",
        input: { command: "npm test" },
      });
    });

    it("parses a Glob tool call", () => {
      const input = `<tool_use>
<name>Glob</name>
<input>{"pattern": "**/*.js", "path": "/home/project"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "Glob",
        input: { pattern: "**/*.js" },
      });
    });

    it("parses a Grep tool call", () => {
      const input = `<tool_use>
<name>Grep</name>
<input>{"pattern": "function.*\\(", "path": "/home/src"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "Grep",
      });
    });

    it("parses multiple tool calls in sequence", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/home/a.js"}</input>
</tool_use>

<tool_use>
<name>read_file</name>
<input>{"path": "/home/b.js"}</input>
</tool_use>

<tool_use>
<name>write_file</name>
<input>{"path": "/home/c.js", "content": "done"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("read_file");
      expect(result[1].name).toBe("read_file");
      expect(result[2].name).toBe("write_file");
    });

    it("assigns unique IDs to each tool call", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/a"}</input>
</tool_use>

<tool_use>
<name>read_file</name>
<input>{"path": "/b"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0].id).not.toBe(result[1].id);
    });

    it("handles malformed JSON in tool input gracefully", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{bad json here}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("read_file");
      expect(result[0].input).toBeDefined();
    });

    it("handles tool call with no input", () => {
      const input = `<tool_use>
<name>some_tool</name>
<input></input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("some_tool");
    });

    it("handles tool call with extra whitespace", () => {
      const input = `<tool_use>
  <name>  read_file  </name>
  <input>  {"path": "/home/test.js"}  </input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
    });
  });

  // ── Diff blocks ───────────────────────────────────────────────
  describe("diff blocks", () => {
    const simpleDiff = `\`\`\`diff
--- a/src/index.js
+++ b/src/index.js
@@ -1,3 +1,3 @@
-const x = 1;
+const x = 2;
 const y = 2;
 const z = 3;
\`\`\``;

    it("parses a simple unified diff", () => {
      const result = parseCliOutput(simpleDiff);
      const patch = result.find((m) => m.type === "patch");
      expect(patch).toBeDefined();
      expect(patch.filePath).toBe("src/index.js");
      expect(patch.new).toContain("const x = 2;");
      expect(patch.old).toContain("const x = 1;");
    });

    it("preserves unchanged lines in diff", () => {
      const result = parseCliOutput(simpleDiff);
      const patch = result.find((m) => m.type === "patch");
      expect(patch.new).toContain("const y = 2;");
      expect(patch.old).toContain("const y = 2;");
    });

    it("parses diff with multiple changes", () => {
      const input = `\`\`\`diff
--- a/src/app.js
+++ b/src/app.js
@@ -1,5 +1,5 @@
 function hello() {
-  console.log("old");
+  console.log("new");
   return true;
-  // removed line
+  // added line
 }
\`\`\``;
      const result = parseCliOutput(input);
      const patch = result.find((m) => m.type === "patch");
      expect(patch.old).toContain('console.log("old")');
      expect(patch.new).toContain('console.log("new")');
      expect(patch.old).toContain("// removed line");
      expect(patch.new).toContain("// added line");
    });

    it("parses diff with only additions (new file)", () => {
      const input = `\`\`\`diff
--- /dev/null
+++ b/src/new.js
@@ -0,0 +1,3 @@
+const a = 1;
+const b = 2;
+const c = 3;
\`\`\``;
      const result = parseCliOutput(input);
      const patch = result.find((m) => m.type === "patch");
      expect(patch).toBeDefined();
      expect(patch.new).toContain("const a = 1;");
    });

    it("parses diff with only deletions (file removal)", () => {
      const input = `\`\`\`diff
--- a/src/old.js
+++ /dev/null
@@ -1,3 +0,0 @@
-const a = 1;
-const b = 2;
-const c = 3;
\`\`\``;
      const result = parseCliOutput(input);
      const patch = result.find((m) => m.type === "patch");
      expect(patch).toBeDefined();
      expect(patch.old).toContain("const a = 1;");
    });

    it("extracts text surrounding diff blocks", () => {
      const input = `Here's the fix:

\`\`\`diff
--- a/src/index.js
+++ b/src/index.js
@@ -1 +1 @@
-old
+new
\`\`\`

Let me know if this works.`;

      const result = parseCliOutput(input);
      const texts = result.filter((m) => m.type === "text");
      expect(texts.length).toBeGreaterThanOrEqual(2);
      expect(texts[0].content).toContain("Here's the fix");
    });

    it("handles multiple diff blocks in one output", () => {
      const input = `\`\`\`diff
--- a/a.js
+++ b/a.js
-old
+new
\`\`\`

\`\`\`diff
--- a/b.js
+++ b/b.js
-old
+new
\`\`\``;
      const result = parseCliOutput(input);
      const patches = result.filter((m) => m.type === "patch");
      expect(patches).toHaveLength(2);
      expect(patches[0].filePath).toBe("a.js");
      expect(patches[1].filePath).toBe("b.js");
    });
  });

  // ── Inline write_file blocks ──────────────────────────────────
  describe("inline write_file blocks", () => {
    it("parses [write_file: path] with <content>", () => {
      const input = `[write_file: /home/test.js]
<content>
console.log("hello");
</content>`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "patch",
        filePath: "/home/test.js",
      });
      expect(result[0].new).toContain('console.log("hello")');
    });

    it("parses multi-line content blocks", () => {
      const input = `[write_file: /home/app.js]
<content>
function hello() {
  console.log("world");
  return 42;
}
</content>`;
      const result = parseCliOutput(input);
      const patch = result.find((m) => m.type === "patch");
      expect(patch.new).toContain("function hello()");
      expect(patch.new).toContain("return 42;");
    });

    it("parses inline [read_file: path]", () => {
      const input = `[read_file: /home/test.js]`;
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "read_file",
        input: { path: "/home/test.js" },
      });
    });
  });

  // ── Mixed content ─────────────────────────────────────────────
  describe("mixed content", () => {
    it("handles text + tool call + text", () => {
      const input = `Let me check the file:

<tool_use>
<name>read_file</name>
<input>{"path": "/home/test.js"}</input>
</tool_use>

The file looks good.`;

      const result = parseCliOutput(input);
      expect(result[0]).toMatchObject({ type: "text" });
      expect(result[1]).toMatchObject({ type: "tool_call", name: "read_file" });
      expect(result[2]).toMatchObject({ type: "text" });
    });

    it("handles text + diff + text", () => {
      const input = `I found the issue:

\`\`\`diff
--- a/src/index.js
+++ b/src/index.js
-old
+new
\`\`\`

Fixed!`;

      const result = parseCliOutput(input);
      expect(result.some((m) => m.type === "text")).toBe(true);
      expect(result.some((m) => m.type === "patch")).toBe(true);
    });

    it("handles tool call + diff + tool call", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/home/a.js"}</input>
</tool_use>

\`\`\`diff
--- a/a.js
+++ b/a.js
-old
+new
\`\`\`

<tool_use>
<name>write_file</name>
<input>{"path": "/home/b.js", "content": "done"}</input>
</tool_use>`;

      const result = parseCliOutput(input);
      const toolCalls = result.filter((m) => m.type === "tool_call");
      const patches = result.filter((m) => m.type === "patch");
      expect(toolCalls).toHaveLength(2);
      expect(patches).toHaveLength(1);
    });

    it("falls back to text for unparseable output", () => {
      const input = "Just some random output with <angle brackets> and {braces}";
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("text");
    });

    it("handles output that is entirely tool calls with no text", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/a"}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result.every((m) => m.type === "tool_call")).toBe(true);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────
  describe("edge cases", () => {
    it("handles tool call with deeply nested JSON", () => {
      const input = `<tool_use>
<name>write_file</name>
<input>{"path": "/a.js", "config": {"a": {"b": {"c": [1,2,3]}}}}</input>
</tool_use>`;
      const result = parseCliOutput(input);
      expect(result[0].input.config.a.b.c).toEqual([1, 2, 3]);
    });

    it("handles special characters in file paths", () => {
      const input = `[read_file: /home/user/my project (copy)/file (1).js]`;
      const result = parseCliOutput(input);
      expect(result[0].input.path).toContain("my project (copy)");
    });

    it("handles Unicode content", () => {
      const input = `Unicode test: 你好世界 🌍 émojis`;
      const result = parseCliOutput(input);
      expect(result[0].content).toContain("你好世界");
    });

    it("handles very large output", () => {
      const lines = Array.from({ length: 1000 }, (_, i) => `Line ${i}`);
      const input = lines.join("\n");
      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("Line 999");
    });

    it("handles concurrent tool_use tags with content between", () => {
      const input = `Analyzing code...

<tool_use>
<name>read_file</name>
<input>{"path": "/a.js"}</input>
</tool_use>

Found the issue. Fixing...

<tool_use>
<name>Edit</name>
<input>{"file_path": "/a.js", "old_string": "bug", "new_string": "fix"}</input>
</tool_use>

Done!`;

      const result = parseCliOutput(input);
      const types = result.map((m) => m.type);
      expect(types).toContain("text");
      expect(types).toContain("tool_call");
    });

    it("handles diff with no file extension", () => {
      const input = `\`\`\`diff
--- a/Makefile
+++ b/Makefile
-old
+new
\`\`\``;
      const result = parseCliOutput(input);
      const patch = result.find((m) => m.type === "patch");
      expect(patch.filePath).toBe("Makefile");
    });

    it("handles output with only tool_use tags (no input/name)", () => {
      const input = `<tool_use>
</tool_use>`;
      const result = parseCliOutput(input);
      // Should not crash
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ── parseDiffContent ──────────────────────────────────────────
  describe("parseDiffContent", () => {
    it("parses added lines", () => {
      const result = parseDiffContent(["+new line"]);
      expect(result.newContent).toBe("new line");
      expect(result.oldContent).toBe("");
    });

    it("parses removed lines", () => {
      const result = parseDiffContent(["-old line"]);
      expect(result.oldContent).toBe("old line");
      expect(result.newContent).toBe("");
    });

    it("parses context lines (space prefix)", () => {
      const result = parseDiffContent([" unchanged"]);
      expect(result.oldContent).toBe("unchanged");
      expect(result.newContent).toBe("unchanged");
    });

    it("skips @@ markers", () => {
      const result = parseDiffContent(["@@ -1,3 +1,3 @@", "-a", "+b"]);
      expect(result.oldContent).toBe("a");
      expect(result.newContent).toBe("b");
    });

    it("handles empty input", () => {
      const result = parseDiffContent([]);
      expect(result.oldContent).toBe("");
      expect(result.newContent).toBe("");
    });

    it("handles complex multi-line diff", () => {
      const lines = [
        "@@ -1,5 +1,5 @@",
        " import foo from 'bar';",
        "-const x = 1;",
        "+const x = 2;",
        " const y = 3;",
        "-const z = 4;",
        "+const z = 5;",
        " export default x + y + z;",
      ];
      const result = parseDiffContent(lines);
      expect(result.oldContent).toContain("const x = 1;");
      expect(result.oldContent).toContain("const z = 4;");
      expect(result.newContent).toContain("const x = 2;");
      expect(result.newContent).toContain("const z = 5;");
    });
  });

  // ── createStreamingParser ──────────────────────────────────────
  describe("createStreamingParser", () => {
    it("collects lines and flushes as messages", () => {
      const parser = createStreamingParser();
      parser.feedLine("Hello");
      parser.feedLine("World");
      const result = parser.flush();
      expect(result).toEqual([{ type: "text", content: "Hello\nWorld" }]);
    });

    it("returns empty array when flushed with no data", () => {
      const parser = createStreamingParser();
      expect(parser.flush()).toEqual([]);
    });

    it("resets buffer on reset()", () => {
      const parser = createStreamingParser();
      parser.feedLine("data");
      parser.reset();
      expect(parser.flush()).toEqual([]);
    });

    it("can flush multiple times independently", () => {
      const parser = createStreamingParser();
      parser.feedLine("first");
      const r1 = parser.flush();
      parser.feedLine("second");
      const r2 = parser.flush();
      expect(r1[0].content).toBe("first");
      expect(r2[0].content).toBe("second");
    });

    it("preserves block state across flushes", () => {
      const parser = createStreamingParser();
      parser.feedLine("Normal text");
      const r1 = parser.flush();
      expect(r1).toHaveLength(1);
      expect(r1[0].type).toBe("text");
    });
  });
});
