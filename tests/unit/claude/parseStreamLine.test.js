import { describe, it, expect } from "vitest";
import { parseStreamLine } from "lib/claude/cliParser";

describe("parseStreamLine", () => {
  it("parses text_delta from assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    });
    expect(parseStreamLine(line)).toEqual({ type: "text_delta", content: "Hello" });
  });

  it("parses tool_use from assistant message", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "src/foo.js" },
          },
        ],
      },
    });
    expect(parseStreamLine(line)).toEqual({
      type: "tool_use",
      id: "toolu_1",
      name: "read_file",
      input: { path: "src/foo.js" },
    });
  });

  it("parses result message", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      cost_usd: 0.05,
    });
    expect(parseStreamLine(line)).toEqual({
      type: "result",
      subtype: "success",
      costUsd: 0.05,
    });
  });

  it("returns null for empty string", () => {
    expect(parseStreamLine("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseStreamLine("not json")).toBeNull();
  });

  it("returns null for unrecognized message type", () => {
    const line = JSON.stringify({ type: "unknown_type" });
    expect(parseStreamLine(line)).toBeNull();
  });

  it("returns first text_delta when text block precedes tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Let me check" },
          { type: "tool_use", id: "toolu_2", name: "read_file", input: {} },
        ],
      },
    });
    const result = parseStreamLine(line);
    expect(result.type).toBe("text_delta");
    expect(result.content).toBe("Let me check");
  });

  it("handles tool_use with empty input", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        content: [{ type: "tool_use", id: "toolu_3", name: "list_files" }],
      },
    });
    expect(parseStreamLine(line)).toEqual({
      type: "tool_use",
      id: "toolu_3",
      name: "list_files",
      input: {},
    });
  });

  it("returns null for null input", () => {
    expect(parseStreamLine(null)).toBeNull();
  });

  it("returns null for whitespace-only input", () => {
    expect(parseStreamLine("   ")).toBeNull();
  });
});
