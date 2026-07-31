/**
 * terminalBridge.js - Bridges WebSocket server with Acode terminal.
 *
 * Handles:
 * - Starting the AI server when terminal opens
 * - Forwarding terminal output to WebSocket clients
 * - Shutting down when terminal closes
 */

const { createServer } = require("./server");

class TerminalBridge {
  constructor() {
    this.server = null;
    this.isRunning = false;
  }

  async start(port) {
    if (this.isRunning) {
      console.log("[TerminalBridge] Already running");
      return;
    }

    this.server = createServer({ port });

    try {
      await this.server.start();
      this.isRunning = true;
      console.log("[TerminalBridge] Server started");
    } catch (err) {
      console.error("[TerminalBridge] Failed to start:", err.message);
      throw err;
    }
  }

  async stop() {
    if (!this.isRunning) return;

    try {
      await this.server.stop();
    } catch (err) {
      console.error("[TerminalBridge] Error stopping:", err.message);
    }

    this.isRunning = false;
    this.server = null;
    console.log("[TerminalBridge] Server stopped");
  }

  getStatus() {
    return {
      running: this.isRunning,
      port: this.server ? this.server.port : null,
      clients: this.server ? this.server.clients.size : 0,
    };
  }
}

module.exports = { TerminalBridge };
