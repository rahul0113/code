import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import aiWebSocket from "ai/websocket";

// Mock WebSocket globally
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CLOSED;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this._sent = [];
    MockWebSocket._instances.push(this);
  }

  send(data) {
    this._sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code: 1000 });
  }

  _simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  _simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  _simulateError(error) {
    if (this.onerror) this.onerror(error || new Event("error"));
  }

  _simulateClose(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code });
  }

  static _instances = [];
  static reset() {
    MockWebSocket._instances = [];
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);

/** Helper: connect and simulate auth in one shot */
async function connectWithAuth() {
  const p = aiWebSocket.connect();
  const ws = MockWebSocket._instances[0];
  if (!ws) throw new Error("No MockWebSocket instance found");
  ws._simulateOpen();
  // Simulate auth response if auth token was set
  if (ws._sent.length > 0) {
    const sent = JSON.parse(ws._sent[0]);
    if (sent.type === "auth") {
      ws._simulateMessage({ type: "authenticated" });
    }
  }
  await p;
  // Small tick to let any microtasks settle
  await new Promise(r => setTimeout(r, 0));
}

beforeEach(() => {
  MockWebSocket.reset();
  aiWebSocket.disconnect();
  // Reset all internal state
  aiWebSocket._authToken = null;
  aiWebSocket._messageId = 0;
  aiWebSocket._reconnectAttempts = 0;
  aiWebSocket._shouldReconnect = false;
  // Clear all listeners
  [
    aiWebSocket._messageListeners,
    aiWebSocket._chunkListeners,
    aiWebSocket._patchListeners,
    aiWebSocket._errorListeners,
    aiWebSocket._disconnectListeners,
    aiWebSocket._connectListeners,
  ].forEach((set) => set.clear());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AIWebSocket", () => {
  it("exports a singleton instance", () => {
    expect(aiWebSocket).toBeDefined();
    expect(typeof aiWebSocket.connect).toBe("function");
    expect(typeof aiWebSocket.disconnect).toBe("function");
    expect(typeof aiWebSocket.send).toBe("function");
  });

  it("starts disconnected", () => {
    expect(aiWebSocket.connected).toBe(false);
  });

  describe("connect()", () => {
    it("connects to localhost:9876", async () => {
      const connectPromise = aiWebSocket.connect();

      const ws = MockWebSocket._instances[0];
      expect(ws).toBeDefined();
      expect(ws.url).toBe("ws://localhost:9876");

      ws._simulateOpen();
      await connectPromise;

      expect(aiWebSocket.connected).toBe(true);
    });

    it("rejects on connection error", async () => {
      const connectPromise = aiWebSocket.connect();

      const ws = MockWebSocket._instances[0];
      ws._simulateError(new Event("error"));

      await expect(connectPromise).rejects.toThrow("WebSocket connection failed");
      expect(aiWebSocket.connected).toBe(false);
    });

    it("resolves immediately if already connected", async () => {
      const p1 = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p1;

      const p2 = aiWebSocket.connect();
      await p2;

      expect(MockWebSocket._instances.length).toBe(1);
    });
  });

  describe("auth", () => {
    it("sends auth message when token is set", async () => {
      aiWebSocket.setAuthToken("test-token-123");
      const p = aiWebSocket.connect();

      const ws = MockWebSocket._instances[0];
      ws._simulateOpen();

      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("auth");
      expect(sent.token).toBe("test-token-123");
    });

    it("resolves after receiving authenticated response", async () => {
      aiWebSocket.setAuthToken("test-token-123");
      const p = aiWebSocket.connect();

      const ws = MockWebSocket._instances[0];
      ws._simulateOpen();
      ws._simulateMessage({ type: "authenticated" });

      await p;
      expect(aiWebSocket.connected).toBe(true);
    });

    it("rejects on auth error response", async () => {
      aiWebSocket.setAuthToken("bad-token");
      const p = aiWebSocket.connect();

      const ws = MockWebSocket._instances[0];
      ws._simulateOpen();
      ws._simulateMessage({ type: "error", message: "Authentication failed" });

      await expect(p).rejects.toThrow("Authentication failed");
    });

    it("connects without auth when no token set", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;
      expect(aiWebSocket.connected).toBe(true);
    });
  });

  describe("disconnect()", () => {
    it("sets connected to false", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.disconnect();
      expect(aiWebSocket.connected).toBe(false);
    });

    it("prevents auto-reconnect", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.disconnect();

      await new Promise((r) => setTimeout(r, 100));

      expect(MockWebSocket._instances.length).toBe(1);
    });
  });

  describe("send()", () => {
    it("sends JSON message with incremented ID", async () => {
      await connectWithAuth();

      aiWebSocket.send("prompt", { prompt: "hello" }).catch(() => {});

      const ws = MockWebSocket._instances[0];
      // First message is auth (if token set), prompt is second; or first if no auth
      const lastSent = ws._sent[ws._sent.length - 1];
      const sent = JSON.parse(lastSent);
      expect(sent.type).toBe("prompt");
      expect(sent.prompt).toBe("hello");
      expect(sent.id).toBeDefined();
    });

    it("rejects if not connected", async () => {
      await expect(aiWebSocket.send("test")).rejects.toThrow("Not connected");
    });

    it("resolves when server responds with matching ID", async () => {
      await connectWithAuth();

      const responsePromise = aiWebSocket.send("test", {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      ws._simulateMessage({ id: sent.id, type: "response", data: "ok" });

      const response = await responsePromise;
      expect(response.type).toBe("response");
      expect(response.data).toBe("ok");
    });

    it("rejects when server responds with error type", async () => {
      await connectWithAuth();

      const responsePromise = aiWebSocket.send("test", {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      ws._simulateMessage({ id: sent.id, type: "error", message: "bad request" });

      await expect(responsePromise).rejects.toThrow("bad request");
    });
  });

  describe("sendPrompt()", () => {
    it("sends prompt message type", async () => {
      await connectWithAuth();

      aiWebSocket.sendPrompt("hello world").catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("prompt");
      expect(sent.prompt).toBe("hello world");
    });
  });

  describe("connectBackend()", () => {
    it("sends connect message", async () => {
      await connectWithAuth();

      aiWebSocket.connectBackend({ model: "claude" }).catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("connect");
      expect(sent.options).toEqual({ model: "claude" });
    });
  });

  describe("applyPatch()", () => {
    it("sends apply_patch message", async () => {
      await connectWithAuth();

      const patchData = { file: "test.js", diff: "..." };
      aiWebSocket.applyPatch(patchData).catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("apply_patch");
      expect(sent.patch).toEqual(patchData);
    });
  });

  describe("rejectPatch()", () => {
    it("sends reject_patch message", async () => {
      await connectWithAuth();

      aiWebSocket.rejectPatch("patch-123").catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("reject_patch");
      expect(sent.patchId).toBe("patch-123");
    });
  });

  describe("cancel()", () => {
    it("sends cancel message", async () => {
      await connectWithAuth();

      aiWebSocket.cancel().catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("cancel");
    });
  });

  describe("disconnectBackend()", () => {
    it("sends disconnect message", async () => {
      await connectWithAuth();

      aiWebSocket.disconnectBackend().catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);
      expect(sent.type).toBe("disconnect");
    });
  });

  describe("event listeners (additive)", () => {
    it("calls onConnect when connected", async () => {
      const onConnect = vi.fn();
      aiWebSocket.onConnect(onConnect);

      await connectWithAuth();

      expect(onConnect).toHaveBeenCalledOnce();
    });

    it("calls onDisconnect when connection drops", async () => {
      const onDisconnect = vi.fn();
      aiWebSocket.onDisconnect(onDisconnect);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateClose();

      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it("calls onMessage for text messages", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "text", content: "hello" });

      expect(onMessage).toHaveBeenCalledWith({ type: "text", content: "hello" });
    });

    it("calls onChunk for streaming messages", async () => {
      const onChunk = vi.fn();
      aiWebSocket.onChunk(onChunk);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "streaming", content: "chunk" });

      expect(onChunk).toHaveBeenCalledWith({ type: "streaming", content: "chunk" });
    });

    it("calls onPatch for patch_applied messages", async () => {
      const onPatch = vi.fn();
      aiWebSocket.onPatch(onPatch);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "patch_applied", id: "1" });

      expect(onPatch).toHaveBeenCalledWith({ type: "patch_applied", id: "1" });
    });

    it("calls onError on connection error", async () => {
      const onError = vi.fn();
      aiWebSocket.onError(onError);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateError(new Event("error"));

      try { await p; } catch {}

      expect(onError).toHaveBeenCalledOnce();
    });

    it("supports multiple listeners on the same event", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      aiWebSocket.onMessage(cb1);
      aiWebSocket.onMessage(cb2);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "text", content: "hi" });

      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it("offMessage removes specific listener", async () => {
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      aiWebSocket.onMessage(cb1);
      aiWebSocket.onMessage(cb2);

      aiWebSocket.offMessage(cb1);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "text", content: "hi" });

      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledOnce();
    });
  });

  describe("message routing", () => {
    it("routes tool_call to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "tool_call", name: "readFile" });

      expect(onMessage).toHaveBeenCalledWith({ type: "tool_call", name: "readFile" });
    });

    it("routes error to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "error", message: "oops" });

      expect(onMessage).toHaveBeenCalledWith({ type: "error", message: "oops" });
    });

    it("routes patch to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "patch", raw: "diff" });

      expect(onMessage).toHaveBeenCalledWith({ type: "patch", raw: "diff" });
    });

    it("routes unknown types to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      await connectWithAuth();

      MockWebSocket._instances[0]._simulateMessage({ type: "custom_type" });

      expect(onMessage).toHaveBeenCalledWith({ type: "custom_type" });
    });
  });

  describe("pending request cleanup", () => {
    it("rejects all pending requests on disconnect", async () => {
      await connectWithAuth();

      const promise1 = aiWebSocket.send("test1", {}).catch(() => {});
      const promise2 = aiWebSocket.send("test2", {}).catch(() => {});

      aiWebSocket.disconnect();

      await Promise.all([promise1, promise2]);
    });

    it("clears timeout on successful response", async () => {
      await connectWithAuth();

      vi.useFakeTimers();

      const promise = aiWebSocket.send("test", {});
      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[ws._sent.length - 1]);

      // Respond before timeout
      ws._simulateMessage({ id: sent.id, type: "response", ok: true });

      const result = await promise;
      expect(result.ok).toBe(true);

      // Advance past the 5-minute timeout — should not error
      vi.advanceTimersByTime(310000);
    });
  });

  describe("reconnect", () => {
    it("schedules reconnect after disconnection", async () => {
      await connectWithAuth();

      vi.useFakeTimers();

      // Drop connection
      MockWebSocket._instances[0]._simulateClose();

      expect(aiWebSocket.connected).toBe(false);

      // Advance past reconnect delay (1s * 2^0 = 1000ms)
      vi.advanceTimersByTime(1100);

      // Should have attempted reconnection
      expect(MockWebSocket._instances.length).toBe(2);
    });

    it("does not reconnect when disconnect() is called explicitly", async () => {
      await connectWithAuth();

      vi.useFakeTimers();

      aiWebSocket.disconnect();
      vi.advanceTimersByTime(5000);

      expect(MockWebSocket._instances.length).toBe(1);
    });

    it("resets reconnect attempts on successful connection", async () => {
      await connectWithAuth();

      vi.useFakeTimers();

      // Drop and reconnect once
      MockWebSocket._instances[0]._simulateClose();
      vi.advanceTimersByTime(1100);

      const ws2 = MockWebSocket._instances[1];
      ws2._simulateOpen();

      // _onConnected runs synchronously in _simulateOpen, so _reconnectAttempts
      // should already be reset. No need to await.
      expect(aiWebSocket._reconnectAttempts).toBe(0);
    });
  });
});
