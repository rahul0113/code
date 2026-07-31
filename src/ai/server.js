/**
 * server.js - WebSocket server for AI assistant backend.
 *
 * Runs inside the proot/Alpine sandbox on localhost:9876.
 * Bridges Acode WebView ↔ OpenClaude CLI via WebSocket.
 */

import crypto from "crypto";
import WebSocket from "ws";
import { createMessageRouter } from "./messageRouter.js";
import { OpenClaudeManager } from "./openClaudeManager.js";
import { PatchManager } from "./patchManager.js";

const DEFAULT_PORT = 9876;

class AIServer {
	constructor(options = {}) {
		this.port = options.port || DEFAULT_PORT;
		this.wss = null;
		this.clients = new Set();
		this.authToken = crypto.randomBytes(32).toString("hex");
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
				this.wss = new WebSocket.Server({
					port: this.port,
					maxPayload: 2 * 1024 * 1024,
				});

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
		let authenticated = false;
		const authTimeout = setTimeout(() => {
			if (!authenticated) {
				ws.close(4001, "Authentication timeout");
			}
		}, 5000);

		ws.on("error", (err) => {
			console.error("[AIServer] Socket error:", err.message);
		});

		ws.on("message", async (data) => {
			let message;
			try {
				message = JSON.parse(data.toString());
			} catch {
				ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
				return;
			}

			if (!authenticated) {
				clearTimeout(authTimeout);
				if (message.type !== "auth" || message.token !== this.authToken) {
					ws.send(
						JSON.stringify({
							type: "error",
							message: "Authentication required",
						}),
					);
					ws.close(4003, "Unauthorized");
					return;
				}
				authenticated = true;
				this.clients.add(ws);
				console.log(
					`[AIServer] Client authenticated (${this.clients.size} total)`,
				);
				ws.send(JSON.stringify({ type: "authenticated" }));
				return;
			}

			if (!message.type || typeof message.type !== "string") {
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Missing or invalid message type",
					}),
				);
				return;
			}

			try {
				await this.router.handleMessage(ws, message);
			} catch (err) {
				console.error("[AIServer] Failed to handle message:", err.message);
				ws.send(
					JSON.stringify({
						type: "error",
						message: "Internal server error",
					}),
				);
			}
		});

		ws.on("close", () => {
			clearTimeout(authTimeout);
			this.clients.delete(ws);
			console.log(
				`[AIServer] Client disconnected (${this.clients.size} remaining)`,
			);
		});
	}
}

function createServer(options) {
	return new AIServer(options);
}

export { AIServer, createServer };
