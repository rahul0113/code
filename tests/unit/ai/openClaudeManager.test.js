import { describe, it, expect, vi } from "vitest";
import { OpenClaudeManager } from "ai/openClaudeManager";
import { EventEmitter } from "events";

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

  describe("onStdoutData", () => {
    it("registers callback for stdout data", () => {
      const mgr = new OpenClaudeManager();
      const stdout = new EventEmitter();
      mgr.process = { stdout, on: vi.fn(), removeListener: vi.fn(), stdin: { write: vi.fn() } };
      mgr.process.killed = false;

      const cb = vi.fn();
      mgr.onStdoutData(cb);

      stdout.emit("data", Buffer.from("hello"));
      expect(cb).toHaveBeenCalledWith("hello");
    });

    it("does nothing when process is null", () => {
      const mgr = new OpenClaudeManager();
      const cb = vi.fn();
      mgr.onStdoutData(cb);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("writeToolResult", () => {
    it("writes JSON to stdin and returns true", () => {
      const mgr = new OpenClaudeManager();
      const stdinWrite = vi.fn();
      mgr.process = { stdin: { write: stdinWrite }, on: vi.fn(), removeListener: vi.fn(), stdout: new EventEmitter() };
      mgr.process.killed = false;

      const result = mgr.writeToolResult('{"ok":true}');
      expect(result).toBe(true);
      expect(stdinWrite).toHaveBeenCalledWith('{"ok":true}\n');
    });

    it("returns false when process is null", () => {
      const mgr = new OpenClaudeManager();
      expect(mgr.writeToolResult('{"ok":true}')).toBe(false);
    });
  });
});
