/**
 * Claude plugin - JS bridge for the Claude coding assistant.
 *
 * This plugin communicates with the Node.js backend running inside the
 * Alpine sandbox via WebSocket. It provides methods to:
 * - Connect/disconnect from the backend
 * - Send messages to Claude
 * - Receive streaming responses
 * - Apply file patches
 */

const Executor = require("cordova/exec");

const CLAUDE_WS_PORT = 9876;
const CONNECT_TIMEOUT_MS = 10000;

/**
 * @typedef {object} ClaudeMessage
 * @property {string} id - Unique message ID
 * @property {string} role - "user" | "assistant"
 * @property {string} content - Message text
 * @property {number} timestamp - Unix timestamp
 * @property {ClaudeToolCall[]} [toolCalls] - Tool calls in this message
 */

/**
 * @typedef {object} ClaudeToolCall
 * @property {string} id - Tool call ID
 * @property {string} name - Tool name (e.g., "read_file", "write_file")
 * @property {object} input - Tool input parameters
 * @property {string} [output] - Tool output (after execution)
 */

/**
 * @typedef {object} ClaudePatch
 * @property {string} filePath - Absolute path to the file
 * @property {string} oldContent - Original file content
 * @property {string} newContent - New file content
 * @property {string} status - "pending" | "applied" | "rejected"
 */

class ClaudeClient {
  constructor() {
    /** @type {WebSocket|null} */
    this._ws = null;
    /** @type {Map<string, Function>} */
    this._pendingRequests = new Map();
    /** @type {Function|null} */
    this._onMessage = null;
    /** @type {Function|null} */
    this._onPatch = null;
    /** @type {Function|null} */
    this._onError = null;
    /** @type {Function|null} */
    this._onDisconnect = null;
    this._messageId = 0;
  }

  /**
   * Connect to the Claude backend WebSocket server.
   * @returns {Promise<void>}
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this._ws && this._ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error("Connection timeout: Claude backend not reachable"));
      }, CONNECT_TIMEOUT_MS);

      try {
        this._ws = new WebSocket(`ws://127.0.0.1:${CLAUDE_WS_PORT}`);

        this._ws.onopen = () => {
          clearTimeout(timeout);
          this._ws.send(JSON.stringify({ type: "handshake", client: "acode" }));
          resolve();
        };

        this._ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

        this._ws.onerror = (err) => {
          clearTimeout(timeout);
          if (this._onError) this._onError(err);
          reject(err);
        };

        this._ws.onclose = () => {
          clearTimeout(timeout);
          if (this._onDisconnect) this._onDisconnect();
        };
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  /**
   * Disconnect from the backend.
   */
  disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  /**
   * Check if connected.
   * @returns {boolean}
   */
  get connected() {
    return this._ws && this._ws.readyState === WebSocket.OPEN;
  }

  /**
   * Send a message to Claude.
   * @param {string} text - The user message
   * @param {object} [context] - Additional context (active file, selection, etc.)
   * @returns {Promise<string>} - The message ID
   */
  async sendMessage(text, context = {}) {
    if (!this.connected) {
      throw new Error("Not connected to Claude backend");
    }

    const id = `msg_${++this._messageId}_${Date.now()}`;

    const message = {
      type: "message",
      id,
      content: text,
      context: {
        activeFile: context.activeFile || null,
        selection: context.selection || null,
        cursorLine: context.cursorLine || null,
        workspace: context.workspace || null,
        ...context,
      },
    };

    this._ws.send(JSON.stringify(message));
    return id;
  }

  /**
   * Apply a patch from Claude's response.
   * @param {string} patchId - The patch ID to apply
   * @returns {Promise<boolean>}
   */
  async applyPatch(patchId) {
    if (!this.connected) {
      throw new Error("Not connected to Claude backend");
    }

    return new Promise((resolve, reject) => {
      const requestId = `patch_apply_${Date.now()}`;

      this._pendingRequests.set(requestId, (response) => {
        this._pendingRequests.delete(requestId);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.success);
        }
      });

      this._ws.send(
        JSON.stringify({
          type: "patch:apply",
          requestId,
          patchId,
        })
      );
    });
  }

  /**
   * Reject a patch (don't apply it).
   * @param {string} patchId - The patch ID to reject
   */
  rejectPatch(patchId) {
    if (!this.connected) return;
    this._ws.send(JSON.stringify({ type: "patch:reject", patchId }));
  }

  /**
   * Cancel the current Claude response stream.
   */
  cancel() {
    if (!this.connected) return;
    this._ws.send(JSON.stringify({ type: "cancel" }));
  }

  /**
   * Set callback for incoming messages (streaming).
   * @param {Function} callback - Called with each message chunk
   */
  onMessage(callback) {
    this._onMessage = callback;
  }

  /**
   * Set callback for patches to review.
   * @param {Function} callback - Called with patch objects
   */
  onPatch(callback) {
    this._onPatch = callback;
  }

  /**
   * Set callback for errors.
   * @param {Function} callback
   */
  onError(callback) {
    this._onError = callback;
  }

  /**
   * Set callback for disconnection.
   * @param {Function} callback
   */
  onDisconnect(callback) {
    this._onDisconnect = callback;
  }

  /** @private */
  _handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    switch (data.type) {
      case "stream":
        if (this._onMessage) {
          this._onMessage({
            id: data.id,
            content: data.content,
            done: data.done || false,
          });
        }
        break;

      case "patch":
        if (this._onPatch) {
          this._onPatch({
            id: data.patchId,
            filePath: data.filePath,
            oldContent: data.oldContent,
            newContent: data.newContent,
            status: "pending",
          });
        }
        break;

      case "error":
        if (this._onError) {
          this._onError(new Error(data.message));
        }
        break;

      default:
        // Handle pending request responses
        if (data.requestId && this._pendingRequests.has(data.requestId)) {
          this._pendingRequests.get(data.requestId)(data);
        }
        break;
    }
  }
}

module.exports = new ClaudeClient();
