import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { createMessageRouter } from "ai/messageRouter";
import { TokenManager } from "ai/tokenManager";
import { ConversationStore } from "ai/conversationStore";

// ── Helpers ──────────────────────────────────────────────────────

function mockWs() {
  const sent = [];
  return {
    sent,
    send(data) {
      sent.push(typeof data === "string" ? JSON.parse(data) : data);
    },
  };
}

function mockOpenClaude(running = true) {
  const stdout = new EventEmitter();
  // Use EventEmitter for process so on("close") actually fires
  const proc = new EventEmitter();
  proc.stdout = stdout;
  proc.stdin = { write: vi.fn() };
  proc.killed = !running;
  return {
    stdout,
    process: proc,
    isRunning: vi.fn().mockReturnValue(running),
    spawn: vi.fn(),
    kill: vi.fn(() => { proc.emit("close"); }),
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

// ── Integration: WebSocket → Agentic Loop → Tool Execution ─────

describe("Integration: Full Agentic Loop", () => {
  let openClaude, patchManager, router, ws;

  beforeEach(() => {
    openClaude = mockOpenClaude();
    patchManager = mockPatchManager();
    router = createMessageRouter({ openClaude, patchManager });
    ws = mockWs();
  });

  it("completes full cycle: connect → prompt → stream → result", async () => {
    // 1. Connect
    await router.handleMessage(ws, { type: "connect", options: { cwd: "/public" } });
    expect(ws.sent[0].type).toBe("connected");

    // 2. Send prompt
    const promptPromise = router.handleMessage(ws, {
      type: "prompt",
      prompt: "explain this code",
    });

    // 3. Simulate Claude streaming text
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "This code does X." }] },
    }) + "\n"));

    // 4. Simulate completion
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "result",
      subtype: "success",
      cost_usd: 0.005,
    }) + "\n"));

    await promptPromise;

    const types = ws.sent.map((s) => s.type);
    expect(types).toContain("streaming");
    expect(types).toContain("text_delta");
    expect(types).toContain("result");
  });

  it("executes tool calls and feeds results back", async () => {
    await router.handleMessage(ws, { type: "connect" });
    ws.sent.length = 0;

    const promptPromise = router.handleMessage(ws, {
      type: "prompt",
      prompt: "read the config file",
    });

    // Claude requests a tool
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_read1",
          name: "read_file",
          input: { path: "/tmp/test.txt" },
        }],
      },
    }) + "\n"));

    // Wait for tool execution
    await new Promise((r) => setTimeout(r, 50));

    // Then Claude finishes
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "result",
      subtype: "success",
      cost_usd: 0.01,
    }) + "\n"));

    await promptPromise;

    expect(ws.sent.some((s) => s.type === "tool_start")).toBe(true);
    expect(ws.sent.some((s) => s.type === "tool_result")).toBe(true);
    expect(openClaude.writeToolResult).toHaveBeenCalled();
  });

  it("handles patch approval flow end-to-end", async () => {
    await router.handleMessage(ws, { type: "connect" });
    ws.sent.length = 0;

    const promptPromise = router.handleMessage(ws, {
      type: "prompt",
      prompt: "fix the bug in index.js",
    });

    // Claude proposes a patch via tool_use
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "assistant",
      message: {
        content: [{
          type: "tool_use",
          id: "toolu_patch1",
          name: "apply_patch",
          input: { filePath: "/tmp/x.js", old: "old", new: "new" },
        }],
      },
    }) + "\n"));

    await new Promise((r) => setTimeout(r, 50));

    // User accepts the patch
    await router.handleMessage(ws, {
      type: "apply_patch",
      patchId: "p1",
    });

    // Then Claude finishes
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "result",
      subtype: "success",
      cost_usd: 0.02,
    }) + "\n"));

    await promptPromise;

    expect(patchManager.queue).toHaveBeenCalled();
    expect(ws.sent.some((s) => s.type === "patch_result" && s.success)).toBe(true);
  });

  it("handles cancel mid-stream gracefully", async () => {
    await router.handleMessage(ws, { type: "connect" });
    ws.sent.length = 0;

    const promptPromise = router.handleMessage(ws, {
      type: "prompt",
      prompt: "write a long file",
    });

    // Start streaming
    openClaude.stdout.emit("data", Buffer.from(JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Starting..." }] },
    }) + "\n"));

    await new Promise((r) => setTimeout(r, 50));

    // User cancels
    await router.handleMessage(ws, { type: "cancel" });

    await promptPromise;

    expect(ws.sent.some((s) => s.type === "cancelled")).toBe(true);
  });
});

// ── Integration: TokenManager + Settings ─────────────────────────

describe("Integration: Token Tracking", () => {
  it("tracks usage across multiple requests", () => {
    const tm = new TokenManager();

    tm.record({ inputTokens: 500, outputTokens: 1000, costUsd: 0.01, model: "claude-sonnet-4-20250514" });
    tm.record({ inputTokens: 300, outputTokens: 700, costUsd: 0.005, model: "claude-sonnet-4-20250514" });

    const usage = tm.getUsage("day");
    expect(usage.tokens).toBe(2500); // 1500 + 1000
    expect(usage.requests).toBe(2);
    expect(usage.costUsd).toBeCloseTo(0.015);
  });

  it("warns when approaching limits", () => {
    const tm = new TokenManager({ dailyTokens: 1000 });

    tm.record({ inputTokens: 800, outputTokens: 100, costUsd: 0.001 });

    const check = tm.checkLimits({ inputTokens: 200, outputTokens: 100 });
    expect(check.ok).toBe(false);
    expect(check.warnings.length).toBeGreaterThan(0);
  });

  it("returns ok when within limits", () => {
    const tm = new TokenManager({ dailyTokens: 1000000 });
    const check = tm.checkLimits({ inputTokens: 100, outputTokens: 100 });
    expect(check.ok).toBe(true);
  });

  it("provides summary for UI display", () => {
    const tm = new TokenManager();
    tm.record({ inputTokens: 1000, outputTokens: 2000, costUsd: 0.05 });

    const summary = tm.getSummary();
    expect(summary.daily.tokens).toBe(3000);
    expect(summary.daily.costUsd).toBe("0.05");
    expect(summary.daily.requests).toBe(1);
    expect(summary.daily.tokenLimit).toBe(1000000);
  });
});

// ── Integration: ConversationStore Persistence ──────────────────

describe("Integration: Conversation Persistence", () => {
  let store;
  const storage = {};
  const mockStorage = {
    getItem: vi.fn((key) => storage[key] || null),
    setItem: vi.fn((key, value) => { storage[key] = value; }),
    removeItem: vi.fn((key) => { delete storage[key]; }),
  };

  beforeEach(() => {
    // ConversationStore uses window.localStorage — create window if missing
    if (typeof globalThis.window === "undefined") {
      globalThis.window = { localStorage: mockStorage };
    } else {
      window.localStorage = mockStorage;
    }
    // Clear storage between tests
    Object.keys(storage).forEach((k) => delete storage[k]);
    store = new ConversationStore();
  });

  afterEach(() => {
    // Don't delete window entirely — other tests may need it
  });

  it("persists conversations across load/save cycles", () => {
    store.create("Test chat");
    const active = store.getActive();
    store.addMessage(active.id, "user", "Hello AI");
    store.addMessage(active.id, "assistant", "Hi there!");

    // Simulate reload
    const store2 = new ConversationStore();
    store2.load();

    const restored = store2.get(active.id);
    expect(restored).not.toBeNull();
    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0].content).toBe("Hello AI");
    expect(restored.messages[1].content).toBe("Hi there!");
  });

  it("generates title from first user message", () => {
    const conv = store.create();
    store.addMessage(conv.id, "user", "How do I fix the login bug?");
    const updated = store.get(conv.id);
    expect(updated.title).toBe("How do I fix the login bug?");
  });

  it("enforces message limit per conversation", () => {
    const conv = store.create();
    for (let i = 0; i < 250; i++) {
      store.addMessage(conv.id, "user", `Message ${i}`);
    }
    const updated = store.get(conv.id);
    expect(updated.messages.length).toBeLessThanOrEqual(200);
  });

  it("deletes conversation and updates active", () => {
    const conv1 = store.create("Chat 1");
    const conv2 = store.create("Chat 2");
    store.setActive(conv1.id);

    store.delete(conv2.id);
    expect(store.get(conv2.id)).toBeNull();
    expect(store.getActiveId()).toBe(conv1.id);
  });
});

// ── Integration: Context Collector Caching ──────────────────────

describe("Integration: Context Collector Caching", () => {
  it("caches tree building results", async () => {
    const { ContextCollector } = await import("ai/contextCollector");
    const collector = new ContextCollector("/public/Acode/src/ai");

    const result1 = collector.collect(".");
    const result2 = collector.collect(".");

    // Both should have the same tree
    expect(result1.tree).toBe(result2.tree);
    // Second call should use cached tree
    expect(collector._treeCache).not.toBeNull();
  });

  it("invalidates cache on demand", async () => {
    const { ContextCollector } = await import("ai/contextCollector");
    const collector = new ContextCollector("/public/Acode/src/ai");

    collector.collect(".");
    expect(collector._treeCache).not.toBeNull();

    collector.invalidateCache();
    expect(collector._treeCache).toBeNull();
    expect(collector._fileCache.size).toBe(0);
  });
});
