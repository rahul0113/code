import { describe, it, expect } from "vitest";
import { OpenClaudeManager } from "ai/openClaudeManager";

describe("OpenClaudeManager", () => {
  it("initializes not running", () => {
    const mgr = new OpenClaudeManager();
    expect(mgr.isRunning()).toBe(false);
  });

  it("has empty output buffer", () => {
    const mgr = new OpenClaudeManager();
    expect(mgr.outputBuffer).toBe("");
  });

  it("getBufferedOutput clears buffer", () => {
    const mgr = new OpenClaudeManager();
    mgr.outputBuffer = "hello";
    const result = mgr.getBufferedOutput();
    expect(result).toBe("hello");
    expect(mgr.outputBuffer).toBe("");
  });

  it("parseBufferedOutput returns empty array for empty buffer", () => {
    const mgr = new OpenClaudeManager();
    const result = mgr.parseBufferedOutput();
    expect(result).toEqual([]);
  });

  it("kill does not throw when not running", () => {
    const mgr = new OpenClaudeManager();
    expect(() => mgr.kill()).not.toThrow();
  });

  it("sendInput throws when not running", () => {
    const mgr = new OpenClaudeManager();
    expect(() => mgr.sendInput("test")).toThrow("not running");
  });
});
