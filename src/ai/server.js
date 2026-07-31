/**
 * server.js - WebSocket server for AI assistant backend.
 *
 * Runs inside the proot/Alpine sandbox on localhost:9876.
 * Bridges Acode WebView ↔ OpenClaude CLI via WebSocket.
 */

const WebSocket = require("ws");
const { createMessageRouter } = require("./messageRouter");
const { OpenClaudeManager } = require("./openClaudeManager");
const { PatchManager } = require("./patchManager");

const DEFAULT_PORT = 9876;

class AIServer {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.wss = null;
    this.clients = new Set();
    this.openClaude = new OpenClaudeManager();
    this.patchManager = new PatchManager();
    this.router = createMessageRouter({
      openClaude: this.openClaude,
      patchManager: this.patchManager,
    });
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocket.Server({ port: this.port });

        this.wss.on("connection", (ws) => {
          this._handleConnection(ws);
        });

        this.wss.on("error", (err) => {
          console.error("[AIServer] WebSocket error:", err.message);
          reject(err);
        });

        console.log(`[AIServer] Listening on ws://localhost:${this.port}`);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  }

  stop() {
    if (this.openClaude) {
      this.openClaude.kill();
    }
    if (this.wss) {
      return new Promise((resolve) => {
        this.wss.close(() => {
          console.log("[AIServer] Stopped");
          resolve();
        });
      });
    }
    return Promise.resolve();
  }

  _handleConnection(ws) {
    this.clients.add(ws);
    console.log(`[AIServer] Client connected (${this.clients.size} total)`);

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());
        await this.router.handleMessage(ws, message);
      } catch (err) {
        console.error("[AIServer] Failed to handle message:", err.message);
        ws.send(JSON.stringify({
          type: "error",
          message: err.message,
        }));
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(`[AIServer] Client disconnected (${this.clients.size} remaining)`);
    });

    ws.send(JSON.stringify({ type: "connected", version: "1.0.0" }));
  }
}

function createServer(options) {
  return new AIServer(options);
}

module.exports = { AIServer, createServer };
