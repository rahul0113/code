/**
 * websocket.js - Client-side WebSocket connection to the AI backend.
 *
 * Connects to the backend WebSocket server running on localhost:9876.
 * Handles connect/disconnect, message correlation, auto-reconnect,
 * authentication, and health pings.
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
		/** @type {Map<string, {resolve: Function, reject: Function, timer: number}>} */
		this._pendingRequests = new Map();
		this._messageId = 0;
		this._pingInterval = null;
		this._reconnectTimer = null;
		this._reconnectAttempts = 0;
		this._shouldReconnect = false;
		this._connected = false;
		this._authenticated = false;
		this._authToken = null;

		// Event listeners (additive, not overwriting)
		/** @type {Set<(msg: object) => void>} */
		this._messageListeners = new Set();
		/** @type {Set<(chunk: object) => void>} */
		this._chunkListeners = new Set();
		/** @type {Set<(patch: object) => void>} */
		this._patchListeners = new Set();
		/** @type {Set<(err: Event) => void>} */
		this._errorListeners = new Set();
		/** @type {Set<() => void>} */
		this._disconnectListeners = new Set();
		/** @type {Set<() => void>} */
		this._connectListeners = new Set();
	}

	get connected() {
		return this._connected;
	}

	/**
	 * Set the authentication token (obtained from server handshake or config).
	 * @param {string} token
	 */
	setAuthToken(token) {
		this._authToken = token;
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

				if (this._authToken) {
					this._ws.send(JSON.stringify({ type: "auth", token: this._authToken }));
				} else {
					settled = true;
					this._onConnected(resolve);
				}
			};

			this._ws.onerror = (event) => {
				clearTimeout(timeout);
				if (!settled) {
					settled = true;
					reject(new Error("WebSocket connection failed"));
				}
				this._emitError(event);
			};

			this._ws.onclose = () => {
				clearTimeout(timeout);
				const wasConnected = this._connected;
				this._connected = false;
				this._authenticated = false;
				this._stopPing();

				if (!settled) {
					settled = true;
					this._rejectAllPending("Connection closed");
					reject(new Error("Connection closed before opening"));
					this._scheduleReconnect();
				} else if (wasConnected) {
					this._rejectAllPending("Connection closed");
					this._emitDisconnect();
					this._scheduleReconnect();
				}
			};

			this._ws.onmessage = (event) => {
				if (!settled && this._authToken) {
					this._handleAuthMessage(event.data, resolve, (err) => {
						settled = true;
						reject(err);
					});
					return;
				}
				this._handleMessage(event.data);
			};
		});
	}

	_onConnected(resolve) {
		this._connected = true;
		this._authenticated = true;
		this._reconnectAttempts = 0;
		this._startPing();
		this._emitConnect();
		if (resolve) resolve();
	}

	_handleAuthMessage(raw, resolve, rejectFn) {
		let msg;
		try {
			msg = JSON.parse(raw);
		} catch {
			return;
		}

		if (msg.type === "authenticated") {
			this._onConnected(resolve);
		} else if (msg.type === "error") {
			rejectFn(new Error(msg.message || "Authentication failed"));
		}
	}

	/**
	 * Disconnect from the backend.
	 */
	disconnect() {
		this._shouldReconnect = false;
		this._stopPing();
		this._clearReconnectTimer();
		this._rejectAllPending("Disconnected");
		if (this._ws) {
			this._ws.onclose = null;
			this._ws.close();
			this._ws = null;
		}
		this._connected = false;
		this._authenticated = false;
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
			const timer = setTimeout(() => {
				if (this._pendingRequests.has(id)) {
					this._pendingRequests.delete(id);
					reject(new Error("Request timed out"));
				}
			}, 300000);

			this._pendingRequests.set(id, { resolve, reject, timer });
			this._ws.send(JSON.stringify(message));
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

	// ── Event registration (additive) ────────────────────────────

	/** @param {(msg: object) => void} cb */
	onMessage(cb) { this._messageListeners.add(cb); }
	/** @param {(chunk: object) => void} cb */
	onChunk(cb) { this._chunkListeners.add(cb); }
	/** @param {(patch: object) => void} cb */
	onPatch(cb) { this._patchListeners.add(cb); }
	/** @param {(err: Event) => void} cb */
	onError(cb) { this._errorListeners.add(cb); }
	/** @param {() => void} cb */
	onDisconnect(cb) { this._disconnectListeners.add(cb); }
	/** @param {() => void} cb */
	onConnect(cb) { this._connectListeners.add(cb); }

	/** @param {(msg: object) => void} cb */
	offMessage(cb) { this._messageListeners.delete(cb); }
	/** @param {(chunk: object) => void} cb */
	offChunk(cb) { this._chunkListeners.delete(cb); }
	/** @param {(patch: object) => void} cb */
	offPatch(cb) { this._patchListeners.delete(cb); }
	/** @param {(err: Event) => void} cb */
	offError(cb) { this._errorListeners.delete(cb); }
	/** @param {() => void} cb */
	offDisconnect(cb) { this._disconnectListeners.delete(cb); }
	/** @param {() => void} cb */
	offConnect(cb) { this._connectListeners.delete(cb); }

	// ── Emit helpers ──────────────────────────────────────────────

	_emitMessage(msg) { for (const cb of this._messageListeners) cb(msg); }
	_emitChunk(chunk) { for (const cb of this._chunkListeners) cb(chunk); }
	_emitPatch(patch) { for (const cb of this._patchListeners) cb(patch); }
	_emitError(err) { for (const cb of this._errorListeners) cb(err); }
	_emitDisconnect() { for (const cb of this._disconnectListeners) cb(); }
	_emitConnect() { for (const cb of this._connectListeners) cb(); }

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
			const { resolve, reject, timer } = this._pendingRequests.get(msg.id);
			clearTimeout(timer);
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
				this._emitMessage(msg);
				break;
			case "streaming":
				this._emitChunk(msg);
				break;
			case "patch_applied":
			case "patch_rejected":
				this._emitPatch(msg);
				break;
			default:
				this._emitMessage(msg);
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
		for (const [id, { reject, timer }] of this._pendingRequests) {
			clearTimeout(timer);
			reject(new Error(reason));
		}
		this._pendingRequests.clear();
	}

	_clearReconnectTimer() {
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = null;
		}
	}

	_scheduleReconnect() {
		if (!this._shouldReconnect) return;

		this._clearReconnectTimer();

		const delay = Math.min(
			RECONNECT_BASE_MS * Math.pow(2, this._reconnectAttempts),
			RECONNECT_MAX_MS,
		);
		this._reconnectAttempts++;

		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			if (this._shouldReconnect && !this._connected) {
				this.connect().catch(() => {});
			}
		}, delay);
	}
}

const aiWebSocket = new AIWebSocket();
export default aiWebSocket;
