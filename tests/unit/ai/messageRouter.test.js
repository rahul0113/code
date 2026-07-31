import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMessageRouter } from "ai/messageRouter";
import { EventEmitter } from "events";

function mockWs() {
  const sent = [];
  return {
    sent,
    send(data) { sent.push(JSON.parse(data)); },
  };
}

function mockOpenClaude(running = true) {
  const stdout = new EventEmitter();
  const stdinWrite = vi.fn();
  return {
    stdout,
    process: { stdout, stdin: { write: stdinWrite }, killed: !running },
    isRunning: vi.fn().mockReturnValue(running),
    spawn: vi.fn(),
    kill: vi.fn(),
    sendInput: vi.fn(),
    writeToolResult: vi.fn().mockReturnValue(true),
  };
}

function mockPatchManager() {
  return {
    queue: vi.fn().mockReturnValue({ id: "p1", filePath: "/tmp/x.js", old: "", new: "code" }),
    apply: vi.fn().mockReturnValue({ success: true, filePath: "/tmp/x.js" }),
    reject: vi.fn(),
  };
}

describe("messageRouter", () => {
  let openClaude, patchManager, router, ws;

  beforeEach(() => {
    openClaude = mockOpenClaude();
    patchManager = mockPatchManager();
    router = createMessageRouter({ openClaude, patchManager });
    ws = mockWs();
  });

  describe("connect", () => {
    it("spawns process and sends connected", async () => {
      await router.handleMessage(ws, { type: "connect", options: { cwd: "/public" } });
      expect(openClaude.spawn).toHaveBeenCalled();
      expect(ws.sent[0].type).toBe("connected");
    });
  });

  describe("disconnect", () => {
    it("kills process and sends disconnected", async () => {
      await router.handleMessage(ws, { type: "disconnect" });
      expect(openClaude.kill).toHaveBeenCalled();
      expect(ws.sent[0].type).toBe("disconnected");
    });
  });

  describe("prompt", () => {
    it("sends error when not connected", async () => {
      openClaude = mockOpenClaude(false);
      openClaude.process = null;
      router = createMessageRouter({ openClaude, patchManager });
      await router.handleMessage(ws, { type: "prompt", prompt: "hello" });
      expect(ws.sent[0].type).toBe("error");
      expect(ws.sent[0].message).toContain("Not connected");
    });

    it("streams text deltas and result", async () => {
      await router.handleMessage(ws, { type: "connect" });
      ws.sent.length = 0;

      const promptPromise = router.handleMessage(ws, {
        type: "prompt",
        prompt: "say hello",
      });

      openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi there!" }] },
      }) + "\n"));

      openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
        type: "result",
        subtype: "success",
        cost_usd: 0.01,
      }) + "\n"));

      await promptPromise;

      const types = ws.sent.map(s => s.type);
      expect(types).toContain("streaming");
      expect(types).toContain("text_delta");
      expect(types).toContain("result");
      expect(ws.sent.find(s => s.type === "text_delta").content).toBe("Hi there!");
    });

    it("executes tool_use and feeds result back", async () => {
      await router.handleMessage(ws, { type: "connect" });
      ws.sent.length = 0;

      const promptPromise = router.handleMessage(ws, {
        type: "prompt",
        prompt: "read file",
      });

      openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "tool_use",
            id: "toolu_1",
            name: "read_file",
            input: { path: "/tmp/test.txt" },
          }],
        },
      }) + "\n"));

      await new Promise(r => setTimeout(r, 50));

      openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
        type: "result",
        subtype: "success",
        cost_usd: 0.02,
      }) + "\n"));

      await promptPromise;

      expect(ws.sent.some(s => s.type === "tool_start")).toBe(true);
      expect(ws.sent.some(s => s.type === "tool_result")).toBe(true);
      expect(openClaude.writeToolResult).toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("kills process and sends cancelled", async () => {
      await router.handleMessage(ws, { type: "cancel" });
      expect(openClaude.kill).toHaveBeenCalled();
      expect(ws.sent[0].type).toBe("cancelled");
    });
  });

  describe("apply_patch", () => {
    it("applies patch and sends result", async () => {
      await router.handleMessage(ws, {
        type: "apply_patch",
        patchId: "p1",
        filePath: "/tmp/x.js",
        old: "",
        new: "code",
      });
      expect(patchManager.apply).toHaveBeenCalled();
      expect(ws.sent[0].type).toBe("patch_result");
      expect(ws.sent[0].success).toBe(true);
    });
  });

  describe("reject_patch", () => {
    it("rejects patch and sends result", async () => {
      await router.handleMessage(ws, {
        type: "reject_patch",
        patchId: "p1",
      });
      expect(patchManager.reject).toHaveBeenCalledWith("p1");
      expect(ws.sent[0].type).toBe("patch_result");
      expect(ws.sent[0].success).toBe(false);
    });
  });

  describe("unknown type", () => {
    it("sends error for unknown message type", async () => {
      await router.handleMessage(ws, { type: "unknown" });
      expect(ws.sent[0].type).toBe("error");
    });
  });
});
