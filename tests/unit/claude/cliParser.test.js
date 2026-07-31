import { describe, it, expect } from "vitest";
import {
  parseCliOutput,
  parseDiffContent,
  createStreamingParser,
} from "lib/claude/cliParser.js";

describe("cliParser", () => {
  describe("parseCliOutput", () => {
    it("should parse plain text output", () => {
      const result = parseCliOutput("Hello, how can I help?");
      expect(result).toEqual([
        { type: "text", content: "Hello, how can I help?" },
      ]);
    });

    it("should parse tool call blocks", () => {
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

    it("should parse write_file tool calls with content", () => {
      const input = `<tool_use>
<name>write_file</name>
<input>{"path": "/home/test.js"}
<content>console.log("hello");
</content></input>
</tool_use>`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "write_file",
      });
    });

    it("should parse inline write_file blocks", () => {
      const input = `[write_file: /home/test.js]
<content>
console.log("hello world");
</content>`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "patch",
        filePath: "/home/test.js",
      });
    });

    it("should parse diff blocks", () => {
      const input = "Here's the fix:\n```diff\n--- a/src/index.js\n+++ b/src/index.js\n@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;\n```\nDone!";

      const result = parseCliOutput(input);
      expect(result).toHaveLength(3); // text, patch, text
      expect(result[1]).toMatchObject({
        type: "patch",
        filePath: "src/index.js",
      });
      expect(result[1].new).toContain("const x = 2;");
      expect(result[1].old).toContain("const x = 1;");
    });

    it("should parse multiple tool calls", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/home/a.js"}</input>
</tool_use>

<tool_use>
<name>read_file</name>
<input>{"path": "/home/b.js"}</input>
</tool_use>`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("read_file");
      expect(result[1].name).toBe("read_file");
    });

    it("should handle inline read_file blocks", () => {
      const input = `[read_file: /home/test.js]`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "read_file",
        input: { path: "/home/test.js" },
      });
    });

    it("should handle empty output", () => {
      const result = parseCliOutput("");
      expect(result).toEqual([]);
    });

    it("should handle mixed text and tool calls", () => {
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

    it("should handle malformed tool call input gracefully", () => {
      const input = `<tool_use>
<name>read_file</name>
<input>{not valid json}</input>
</tool_use>`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "read_file",
      });
      // Should fall back to raw input
      expect(result[0].input).toBeDefined();
    });

    it("should parse Edit tool calls", () => {
      const input = `<tool_use>
<name>Edit</name>
<input>{"old_string": "foo", "new_string": "bar", "file_path": "/home/test.js"}</input>
</tool_use>`;

      const result = parseCliOutput(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: "tool_call",
        name: "Edit",
        input: {
          old_string: "foo",
          new_string: "bar",
          file_path: "/home/test.js",
        },
      });
    });
  });

  describe("parseDiffContent", () => {
    it("should parse unified diff lines", () => {
      const lines = ["-old line", "+new line", " context line"];
      const result = parseDiffContent(lines);
      expect(result.oldContent).toBe("old line\ncontext line");
      expect(result.newContent).toBe("new line\ncontext line");
    });

    it("should skip @@ markers", () => {
      const lines = ["@@ -1,3 +1,3 @@", "-old", "+new"];
      const result = parseDiffContent(lines);
      expect(result.oldContent).toBe("old");
      expect(result.newContent).toBe("new");
    });

    it("should handle empty diff", () => {
      const result = parseDiffContent([]);
      expect(result.oldContent).toBe("");
      expect(result.newContent).toBe("");
    });
  });

  describe("createStreamingParser", () => {
    it("should collect lines and flush as messages", () => {
      const parser = createStreamingParser();
      parser.feedLine("Hello");
      parser.feedLine("World");

      const result = parser.flush();
      expect(result).toEqual([{ type: "text", content: "Hello\nWorld" }]);
    });

    it("should reset buffer on reset()", () => {
      const parser = createStreamingParser();
      parser.feedLine("Hello");
      parser.reset();

      const result = parser.flush();
      expect(result).toEqual([]);
    });
  });
});
