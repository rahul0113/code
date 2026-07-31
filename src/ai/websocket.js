/**
 * websocket.js - Client-side WebSocket connection to the AI backend.
 *
 * Connects to the backend WebSocket server running on localhost:9876.
 * Handles connect/disconnect, message correlation, auto-reconnect,
 * and health pings.
 */

const WS_PORT = 9876;
const CONNECT_TIMEOUT_MS = 10000;
const PING_INTERVAL_MS = 30000;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

class AIWebSocket {
	constructor() {
		/** @type {WebSocket|null} */
		this._ws = null;
		/** @type {Map<string, {resolve: Function, reject: Function}>} */
		this._pendingRequests = new Map();
		this._messageId = 0;
		this._pingInterval = null;
		this._reconnectAttempts = 0;
		this._shouldReconnect = false;
		this._connected = false;

		// Event callbacks
		this._onMessage = null;
		this._onChunk = null;
		this._onPatch = null;
		this._onError = null;
		this._onDisconnect = null;
		this._onConnect = null;
	}

	get connected() {
		return this._connected;
	}

	/**
	 * Connect to the backend WebSocket server.
	 * @returns {Promise<void>}
	 */
	connect() {
		if (this._ws && this._connected) return Promise.resolve();

		this._shouldReconnect = true;

		return new Promise((resolve, reject) => {
			const wsUrl = `ws://localhost:${WS_PORT}`;
			let settled = false;

			try {
				this._ws = new WebSocket(wsUrl);
			} catch (err) {
				settled = true;
				reject(err);
				return;
			}

			const timeout = setTimeout(() => {
				if (!settled) {
					settled = true;
					this._ws?.close();
					reject(new Error("Connection timed out"));
				}
			}, CONNECT_TIMEOUT_MS);

			this._ws.onopen = () => {
				clearTimeout(timeout);
				if (settled) return;
				settled = true;

				this._connected = true;
				this._reconnectAttempts = 0;
				this._startPing();
				this._onConnect?.();
				resolve();
			};

			this._ws.onerror = (event) => {
				clearTimeout(timeout);
				if (!settled) {
					settled = true;
					reject(new Error("WebSocket connection failed"));
				}
				this._onError?.(event);
			};

			this._ws.onclose = () => {
				clearTimeout(timeout);
				const wasConnected = this._connected;
				this._connected = false;
				this._stopPing();
				this._rejectAllPending("Connection closed");

				if (wasConnected) {
					this._onDisconnect?.();
				}

				if (!settled) {
					settled = true;
					reject(new Error("Connection closed before opening"));
				}

				this._scheduleReconnect();
			};

			this._ws.onmessage = (event) => {
				this._handleMessage(event.data);
			};
		});
	}

	/**
	 * Disconnect from the backend.
	 */
	disconnect() {
		this._shouldReconnect = false;
		this._stopPing();
		this._rejectAllPending("Disconnected");
		if (this._ws) {
			this._ws.onclose = null;
			this._ws.close();
			this._ws = null;
		}
		this._connected = false;
	}

	/**
	 * Send a message to the backend.
	 * @param {string} type - Message type
	 * @param {object} payload - Additional message data
	 * @returns {Promise<object>} - Server response
	 */
	send(type, payload = {}) {
		if (!this._connected || !this._ws) {
			return Promise.reject(new Error("Not connected"));
		}

		const id = String(++this._messageId);
		const message = { id, type, ...payload };

		return new Promise((resolve, reject) => {
			this._pendingRequests.set(id, { resolve, reject });
			this._ws.send(JSON.stringify(message));

			// Timeout pending requests after 5 minutes
			setTimeout(() => {
				if (this._pendingRequests.has(id)) {
					this._pendingRequests.delete(id);
					reject(new Error("Request timed out"));
				}
			}, 300000);
		});
	}

	/**
	 * Send a prompt to Claude.
	 * @param {string} prompt - User prompt text
	 * @returns {Promise<void>}
	 */
	async sendPrompt(prompt) {
		await this.send("prompt", { prompt });
	}

	/**
	 * Connect to the backend and initialize the Claude process.
	 * @param {object} [options] - Connection options
	 * @returns {Promise<void>}
	 */
	async connectBackend(options = {}) {
		await this.send("connect", { options });
	}

	/**
	 * Apply a patch.
	 * @param {object} patch - Patch data
	 * @returns {Promise<object>}
	 */
	applyPatch(patch) {
		return this.send("apply_patch", { patch });
	}

	/**
	 * Reject a patch.
	 * @param {string} patchId - Patch ID to reject
	 * @returns {Promise<object>}
	 */
	rejectPatch(patchId) {
		return this.send("reject_patch", { patchId });
	}

	/**
	 * Cancel the current operation.
	 * @returns {Promise<object>}
	 */
	cancel() {
		return this.send("cancel");
	}

	/**
	 * Disconnect from the backend process.
	 * @returns {Promise<object>}
	 */
	disconnectBackend() {
		return this.send("disconnect");
	}

	// ── Event registration ────────────────────────────────────────

	/** @param {(msg: object) => void} cb */
	onMessage(cb) { this._onMessage = cb; }
	/** @param {(chunk: object) => void} cb */
	onChunk(cb) { this._onChunk = cb; }
	/** @param {(patch: object) => void} cb */
	onPatch(cb) { this._onPatch = cb; }
	/** @param {(err: Event) => void} cb */
	onError(cb) { this._onError = cb; }
	/** @param {() => void} cb */
	onDisconnect(cb) { this._onDisconnect = cb; }
	/** @param {() => void} cb */
	onConnect(cb) { this._onConnect = cb; }

	// ── Internal ──────────────────────────────────────────────────

	/**
	 * Handle incoming WebSocket message.
	 * @param {string} raw
	 */
	_handleMessage(raw) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		// Resolve pending request if ID matches
		if (msg.id && this._pendingRequests.has(msg.id)) {
			const { resolve, reject } = this._pendingRequests.get(msg.id);
			this._pendingRequests.delete(msg.id);
			if (msg.type === "error") {
				reject(new Error(msg.message));
			} else {
				resolve(msg);
			}
			return;
		}

		// Route by message type
		switch (msg.type) {
			case "text":
			case "tool_call":
			case "patch":
			case "error":
				this._onMessage?.(msg);
				break;
			case "streaming":
				this._onChunk?.(msg);
				break;
			case "patch_applied":
			case "patch_rejected":
				this._onPatch?.(msg);
				break;
			default:
				this._onMessage?.(msg);
		}
	}

	_startPing() {
		this._stopPing();
		this._pingInterval = setInterval(() => {
			if (this._ws && this._ws.readyState === WebSocket.OPEN) {
				this._ws.send(JSON.stringify({ type: "ping" }));
			}
		}, PING_INTERVAL_MS);
	}

	_stopPing() {
		if (this._pingInterval) {
			clearInterval(this._pingInterval);
			this._pingInterval = null;
		}
	}

	_rejectAllPending(reason) {
		for (const [id, { reject }] of this._pendingRequests) {
			reject(new Error(reason));
		}
		this._pendingRequests.clear();
	}

	_scheduleReconnect() {
		if (!this._shouldReconnect) return;

		const delay = Math.min(
			RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts),
			RECONNECT_MAX_MS,
		);
		this._reconnectAttempts++;

		setTimeout(() => {
			if (this._shouldReconnect && !this._connected) {
				this.connect().catch(() => {});
			}
		}, delay);
	}
}

const aiWebSocket = new AIWebSocket();
export default aiWebSocket;
