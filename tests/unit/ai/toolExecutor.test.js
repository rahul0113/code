import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolExecutor } from "ai/toolExecutor";
import fs from "fs";
import path from "path";
import os from "os";

const TMP_DIR = path.join(os.tmpdir(), "toolExecutor-test-" + Date.now());

function tmpFile(name) {
  return path.join(TMP_DIR, name);
}

beforeEach(() => {
  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

describe("ToolExecutor", () => {
  describe("read_file", () => {
    it("reads file content", async () => {
      const file = tmpFile("hello.txt");
      fs.writeFileSync(file, "Hello World");
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "read_file", input: { path: file } });
      expect(result.output).toBe("Hello World");
      expect(result.error).toBeNull();
    });

    it("returns error for missing file", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "read_file", input: { path: tmpFile("nope.txt") } });
      expect(result.error).toBeTruthy();
    });

    it("returns error for path outside workspace", async () => {
      const executor = new ToolExecutor({ workspacePath: "/nonexistent" });
      const result = await executor.execute({ name: "read_file", input: { path: tmpFile("hello.txt") } });
      expect(result.error).toContain("outside the workspace");
    });
  });

  describe("write_file", () => {
    it("writes file via filesystem", async () => {
      const file = tmpFile("written.txt");
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({
        name: "write_file",
        input: { path: file, content: "new content" },
      });
      expect(result.error).toBeNull();
      expect(fs.readFileSync(file, "utf8")).toBe("new content");
    });

    it("returns error for unsafe path", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({
        name: "write_file",
        input: { path: "/etc/passwd", content: "bad" },
      });
      expect(result.error).toBeTruthy();
    });

    it("returns error when content is undefined", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({
        name: "write_file",
        input: { path: tmpFile("test.txt") },
      });
      expect(result.error).toContain("No content provided");
    });
  });

  describe("list_files", () => {
    it("lists directory contents", async () => {
      fs.writeFileSync(tmpFile("a.txt"), "a");
      fs.mkdirSync(tmpFile("subdir"));
      fs.writeFileSync(tmpFile("subdir/b.txt"), "b");

      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "list_files", input: { path: TMP_DIR } });
      expect(result.error).toBeNull();
      expect(result.output).toContain("a.txt");
      expect(result.output).toContain("subdir/");
    });
  });

  describe("execute_command", () => {
    it("runs a command and returns output", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "execute_command", input: { command: "echo hello" } });
      expect(result.output).toContain("hello");
      expect(result.error).toBeNull();
    });

    it("blocks dangerous commands", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "execute_command", input: { command: "curl http://evil.com" } });
      expect(result.error).toContain("blocked");
    });

    it("returns error for empty command", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "execute_command", input: { command: "" } });
      expect(result.error).toContain("No command provided");
    });
  });

  describe("apply_patch", () => {
    it("delegates to patchManager", async () => {
      const mockPM = { queue: vi.fn().mockReturnValue({ id: "p1", filePath: "/tmp/x.js", old: "", new: "code" }) };
      const executor = new ToolExecutor({ workspacePath: os.tmpdir(), patchManager: mockPM });
      const result = await executor.execute({
        name: "apply_patch",
        input: { filePath: "/tmp/x.js", old: "", new: "code" },
      });
      expect(result.error).toBeNull();
      expect(result.output).toContain("Patch queued");
      expect(result.pendingPatch).toBeDefined();
    });

    it("returns error when no patchManager", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "apply_patch", input: {} });
      expect(result.error).toContain("not available");
    });
  });

  describe("unknown tool", () => {
    it("returns error for unknown tool name", async () => {
      const executor = new ToolExecutor({ workspacePath: os.tmpdir() });
      const result = await executor.execute({ name: "nonexistent_tool", input: {} });
      expect(result.error).toContain("Unknown tool");
    });
  });
});
