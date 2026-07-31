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

beforeEach(() => {
  MockWebSocket.reset();
  aiWebSocket.disconnect();
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
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.send("prompt", { prompt: "hello" }).catch(() => {});

      const ws = MockWebSocket._instances[0];
      expect(ws._sent.length).toBe(1);
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("prompt");
      expect(sent.prompt).toBe("hello");
      expect(sent.id).toBeDefined();
    });

    it("rejects if not connected", async () => {
      await expect(aiWebSocket.send("test")).rejects.toThrow("Not connected");
    });

    it("resolves when server responds with matching ID", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      const responsePromise = aiWebSocket.send("test", {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      ws._simulateMessage({ id: sent.id, type: "response", data: "ok" });

      const response = await responsePromise;
      expect(response.type).toBe("response");
      expect(response.data).toBe("ok");
    });

    it("rejects when server responds with error type", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      const responsePromise = aiWebSocket.send("test", {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      ws._simulateMessage({ id: sent.id, type: "error", message: "bad request" });

      await expect(responsePromise).rejects.toThrow("bad request");
    });
  });

  describe("sendPrompt()", () => {
    it("sends prompt message type", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.sendPrompt("hello world").catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("prompt");
      expect(sent.prompt).toBe("hello world");
    });
  });

  describe("connectBackend()", () => {
    it("sends connect message", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.connectBackend({ model: "claude" }).catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("connect");
      expect(sent.options).toEqual({ model: "claude" });
    });
  });

  describe("applyPatch()", () => {
    it("sends apply_patch message", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      const patchData = { file: "test.js", diff: "..." };
      aiWebSocket.applyPatch(patchData).catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("apply_patch");
      expect(sent.patch).toEqual(patchData);
    });
  });

  describe("rejectPatch()", () => {
    it("sends reject_patch message", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.rejectPatch("patch-123").catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("reject_patch");
      expect(sent.patchId).toBe("patch-123");
    });
  });

  describe("cancel()", () => {
    it("sends cancel message", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.cancel().catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("cancel");
    });
  });

  describe("disconnectBackend()", () => {
    it("sends disconnect message", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      aiWebSocket.disconnectBackend().catch(() => {});

      const ws = MockWebSocket._instances[0];
      const sent = JSON.parse(ws._sent[0]);
      expect(sent.type).toBe("disconnect");
    });
  });

  describe("event callbacks", () => {
    it("calls onConnect when connected", async () => {
      const onConnect = vi.fn();
      aiWebSocket.onConnect(onConnect);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      expect(onConnect).toHaveBeenCalledOnce();
    });

    it("calls onDisconnect when connection drops", async () => {
      const onDisconnect = vi.fn();
      aiWebSocket.onDisconnect(onDisconnect);

      const p = aiWebSocket.connect();
      const ws = MockWebSocket._instances[0];
      ws._simulateOpen();
      await p;

      ws._simulateClose();

      expect(onDisconnect).toHaveBeenCalledOnce();
    });

    it("calls onMessage for text messages", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "text", content: "hello" });

      expect(onMessage).toHaveBeenCalledWith({ type: "text", content: "hello" });
    });

    it("calls onChunk for streaming messages", async () => {
      const onChunk = vi.fn();
      aiWebSocket.onChunk(onChunk);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "streaming", content: "chunk" });

      expect(onChunk).toHaveBeenCalledWith({ type: "streaming", content: "chunk" });
    });

    it("calls onPatch for patch_applied messages", async () => {
      const onPatch = vi.fn();
      aiWebSocket.onPatch(onPatch);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

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
  });

  describe("message routing", () => {
    it("routes tool_call to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "tool_call", name: "readFile" });

      expect(onMessage).toHaveBeenCalledWith({ type: "tool_call", name: "readFile" });
    });

    it("routes error to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "error", message: "oops" });

      expect(onMessage).toHaveBeenCalledWith({ type: "error", message: "oops" });
    });

    it("routes patch to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "patch", raw: "diff" });

      expect(onMessage).toHaveBeenCalledWith({ type: "patch", raw: "diff" });
    });

    it("routes unknown types to onMessage", async () => {
      const onMessage = vi.fn();
      aiWebSocket.onMessage(onMessage);

      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      MockWebSocket._instances[0]._simulateMessage({ type: "custom_type" });

      expect(onMessage).toHaveBeenCalledWith({ type: "custom_type" });
    });
  });

  describe("pending request cleanup", () => {
    it("rejects all pending requests on disconnect", async () => {
      const p = aiWebSocket.connect();
      MockWebSocket._instances[0]._simulateOpen();
      await p;

      const promise1 = aiWebSocket.send("test1", {}).catch(() => {});
      const promise2 = aiWebSocket.send("test2", {}).catch(() => {});

      aiWebSocket.disconnect();

      await Promise.all([promise1, promise2]);
    });
  });
});
