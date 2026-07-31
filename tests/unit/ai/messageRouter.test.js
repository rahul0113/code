import { describe, it, expect, vi } from "vitest";
import { createMessageRouter } from "ai/messageRouter";

function createMockWs() {
  const messages = [];
  return {
    messages,
    send: (data) => messages.push(JSON.parse(data)),
  };
}

function createMockOpenClaude(running = false) {
  return {
    isRunning: () => running,
    spawn: vi.fn(),
    kill: vi.fn(),
    sendInput: vi.fn(),
    parseBufferedOutput: () => [{ type: "text", content: "test response" }],
  };
}

function createMockPatchManager() {
  return {
    apply: vi.fn(() => ({ success: true, filePath: "/test.js" })),
    reject: vi.fn(),
  };
}

describe("messageRouter", () => {
  it("handles unknown message type", async () => {
    const router = createMessageRouter({
      openClaude: createMockOpenClaude(),
      patchManager: createMockPatchManager(),
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "unknown" });
    expect(ws.messages[0].type).toBe("error");
  });

  it("handles connect message", async () => {
    const openClaude = createMockOpenClaude();
    const router = createMessageRouter({
      openClaude,
      patchManager: createMockPatchManager(),
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "connect", options: { model: "test" } });
    expect(openClaude.spawn).toHaveBeenCalledWith({ model: "test" });
    expect(ws.messages[0].type).toBe("connected");
  });

  it("handles disconnect message", async () => {
    const openClaude = createMockOpenClaude();
    const router = createMessageRouter({
      openClaude,
      patchManager: createMockPatchManager(),
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "disconnect" });
    expect(openClaude.kill).toHaveBeenCalled();
    expect(ws.messages[0].type).toBe("disconnected");
  });

  it("handles prompt when not connected", async () => {
    const router = createMessageRouter({
      openClaude: createMockOpenClaude(false),
      patchManager: createMockPatchManager(),
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "prompt", prompt: "hello" });
    expect(ws.messages[0].type).toBe("error");
    expect(ws.messages[0].message).toContain("Not connected");
  });

  it("handles apply_patch", async () => {
    const patchMgr = createMockPatchManager();
    const router = createMessageRouter({
      openClaude: createMockOpenClaude(),
      patchManager: patchMgr,
    });
    const ws = createMockWs();
    const patch = { filePath: "/test.js", old: "a", new: "b" };
    await router.handleMessage(ws, { type: "apply_patch", patch });
    expect(patchMgr.apply).toHaveBeenCalledWith(patch);
    expect(ws.messages[0].type).toBe("patch_applied");
    expect(ws.messages[0].success).toBe(true);
  });

  it("handles reject_patch", async () => {
    const patchMgr = createMockPatchManager();
    const router = createMessageRouter({
      openClaude: createMockOpenClaude(),
      patchManager: patchMgr,
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "reject_patch", patchId: "patch-1" });
    expect(patchMgr.reject).toHaveBeenCalledWith("patch-1");
    expect(ws.messages[0].type).toBe("patch_rejected");
  });

  it("handles cancel", async () => {
    const openClaude = createMockOpenClaude();
    const router = createMessageRouter({
      openClaude,
      patchManager: createMockPatchManager(),
    });
    const ws = createMockWs();
    await router.handleMessage(ws, { type: "cancel" });
    expect(openClaude.kill).toHaveBeenCalled();
    expect(ws.messages[0].type).toBe("cancelled");
  });
});
