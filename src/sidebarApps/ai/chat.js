/**
 * chat.js - Chat UI for the AI coding assistant.
 *
 * Renders the message list, input box, and send button.
 * Handles streaming display and markdown rendering.
 */

import toast from "../../components/toast";
import aiWebSocket from "../../ai/websocket";

const INPUT_MAX_LENGTH = 32768;

class AIChat {
	constructor() {
		/** @type {HTMLElement|null} */
		this._el = null;
		/** @type {HTMLElement|null} */
		this._messagesEl = null;
		/** @type {HTMLTextAreaElement|null} */
		this._inputEl = null;
		/** @type {HTMLButtonElement|null} */
		this._sendBtn = null;
		/** @type {HTMLButtonElement|null} */
		this._cancelBtn = null;
		/** @type {HTMLElement|null} */
		this._streamingEl = null;
		/** @type {object[]} */
		this._messages = [];
		/** @type {boolean} */
		this._processing = false;
		/** @type {number} */
		this._generation = 0;

		this._handleSend = this._handleSend.bind(this);
		this._handleCancel = this._handleCancel.bind(this);
		this._handleKeydown = this._handleKeydown.bind(this);

		// Bind WebSocket handlers for proper cleanup
		this._onMessage = (msg) => this._handleServerMessage(msg);
		this._onChunk = (msg) => this._handleChunk(msg);
		this._onPatch = (msg) => this._handlePatch(msg);
		this._onError = () => {
			this._setProcessing(false);
			toast("Connection error", 3000);
		};
		this._onDisconnect = () => {
			this._setProcessing(false);
			this._updateStatus("disconnected");
		};
		this._onConnect = () => {
			this._updateStatus("connected");
		};
	}

	/**
	 * Create the chat UI inside a container element.
	 * @param {HTMLElement} container
	 * @returns {Function} cleanup function
	 */
	create(container) {
		const gen = ++this._generation;
		this._el = container;
		container.classList.add("ai-chat");

		// Status bar
		const status = <div className="ai-chat__status">
			<span className="ai-chat__status-dot"></span>
			<span className="ai-chat__status-text">Disconnected</span>
		</div>;

		// Messages area
		this._messagesEl = <div className="ai-chat__messages">
			<div className="ai-chat__welcome">
				<div className="ai-chat__welcome-icon icon brain"></div>
				<div className="ai-chat__welcome-title">AI Coding Assistant</div>
				<div className="ai-chat__welcome-text">
					Ask me to help with your code. I can read files, suggest changes, and apply patches.
				</div>
			</div>
		</div>;

		// Input area
		this._inputEl = (
			<textarea
				className="ai-chat__input"
				placeholder="Ask about your code..."
				rows="3"
				maxLength={INPUT_MAX_LENGTH}
			/>
		);

		this._sendBtn = (
			<button className="ai-chat__send-btn icon add" title="Send"></button>
		);

		this._cancelBtn = (
			<button className="ai-chat__cancel-btn icon cancel" title="Cancel"></button>
		);

		const inputArea = <div className="ai-chat__input-area">
			{this._inputEl}
			<div className="ai-chat__input-actions">
				{this._sendBtn}
				{this._cancelBtn}
			</div>
		</div>;

		container.appendChild(status);
		container.appendChild(this._messagesEl);
		container.appendChild(inputArea);

		// Event listeners
		this._sendBtn.addEventListener("click", this._handleSend);
		this._cancelBtn.addEventListener("click", this._handleCancel);
		this._inputEl.addEventListener("keydown", this._handleKeydown);

		// WebSocket callbacks (additive — won't overwrite other consumers)
		aiWebSocket.onMessage(this._onMessage);
		aiWebSocket.onChunk(this._onChunk);
		aiWebSocket.onPatch(this._onPatch);
		aiWebSocket.onError(this._onError);
		aiWebSocket.onDisconnect(this._onDisconnect);
		aiWebSocket.onConnect(this._onConnect);

		// Handle virtual keyboard on mobile — scroll input into view when focused
		if (this._inputEl) {
			this._inputEl.addEventListener("focus", () => {
				setTimeout(() => {
					this._inputEl?.scrollIntoView({ behavior: "smooth", block: "end" });
				}, 300); // Delay for keyboard animation
			});
		}

		// Auto-connect
		aiWebSocket.connect()
			.then(() => {
				if (this._generation !== gen) return;
				aiWebSocket.connectBackend();
			})
			.catch(() => {});

		return () => {
			// Only clean up if this generation is still active
			if (this._generation !== gen) return;

			this._sendBtn.removeEventListener("click", this._handleSend);
			this._cancelBtn.removeEventListener("click", this._handleCancel);
			this._inputEl.removeEventListener("keydown", this._handleKeydown);

			aiWebSocket.offMessage(this._onMessage);
			aiWebSocket.offChunk(this._onChunk);
			aiWebSocket.offPatch(this._onPatch);
			aiWebSocket.offError(this._onError);
			aiWebSocket.offDisconnect(this._onDisconnect);
			aiWebSocket.offConnect(this._onConnect);

			aiWebSocket.disconnect();

			this._el = null;
			this._messagesEl = null;
			this._inputEl = null;
			this._sendBtn = null;
			this._cancelBtn = null;
			this._streamingEl = null;
			this._messages = [];
		};
	}

	/**
	 * Handle sending a message.
	 */
	async _handleSend() {
		const text = this._inputEl?.value.trim();
		if (!text || this._processing) return;

		// Connect if not connected
		if (!aiWebSocket.connected) {
			try {
				await aiWebSocket.connect();
				await aiWebSocket.connectBackend();
			} catch {
				toast("Failed to connect to backend", 3000);
				return;
			}
		}

		if (this._inputEl) this._inputEl.value = "";
		this._addMessage("user", text);
		this._setProcessing(true);
		this._createStreamingMessage();

		try {
			await aiWebSocket.sendPrompt(text);
		} catch (err) {
			this._removeStreamingMessage();
			this._setProcessing(false);
			toast(err.message, 3000);
		}
	}

	/**
	 * Handle cancel button.
	 */
	async _handleCancel() {
		if (!this._processing) return;
		try {
			await aiWebSocket.cancel();
		} catch {
			// ignore
		}
		this._removeStreamingMessage();
		this._setProcessing(false);
	}

	/**
	 * Handle Enter key in input.
	 * @param {KeyboardEvent} e
	 */
	_handleKeydown(e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this._handleSend().catch(() => {});
		}
	}

	/**
	 * Add a message to the chat.
	 * @param {"user"|"assistant"} role
	 * @param {string} content
	 */
	_addMessage(role, content) {
		// Remove welcome message
		const welcome = this._messagesEl?.querySelector(".ai-chat__welcome");
		if (welcome) welcome.remove();

		const msg = { role, content, timestamp: Date.now() };
		this._messages.push(msg);

		const el = <div className={`ai-chat__message ai-chat__message--${role}`}>
			<div className="ai-chat__message-content md">{content}</div>
		</div>;
		this._messagesEl?.appendChild(el);
		this._scrollToBottom();
	}

	/**
	 * Create a streaming message placeholder for AI response.
	 */
	_createStreamingMessage() {
		this._removeStreamingMessage();
		this._streamingEl = <div className="ai-chat__message ai-chat__message--assistant ai-chat__message--streaming">
			<div className="ai-chat__message-content md">
				<div className="ai-chat__typing-indicator">
					<span></span><span></span><span></span>
				</div>
			</div>
		</div>;
		this._messagesEl?.appendChild(this._streamingEl);
		this._scrollToBottom();
	}

	/**
	 * Remove the streaming message placeholder.
	 */
	_removeStreamingMessage() {
		if (this._streamingEl) {
			this._streamingEl.remove();
			this._streamingEl = null;
		}
	}

	/**
	 * Handle a server message (text, tool_start, tool_result, patch, error).
	 * @param {object} msg
	 */
	_handleServerMessage(msg) {
		switch (msg.type) {
			case "text":
				this._appendToStreaming(msg.content || msg.text || "");
				break;
			case "tool_start":
				this._appendToStreaming(`\n\n> **Tool:** ${msg.name}\n> Running...\n`);
				break;
			case "tool_result": {
				const status = msg.error ? `Error: ${msg.error}` : "Done";
				const preview = msg.output
					? msg.output.slice(0, 500) + (msg.output.length > 500 ? "\n... (truncated)" : "")
					: "";
				let text = `> ${status}\n`;
				if (preview) text += `\`\`\`\n${preview}\n\`\`\`\n`;
				this._appendToStreaming(text);
				break;
			}
			case "tool_call":
				this._appendToStreaming(`\n\`\`\`\nTool: ${msg.name}\nInput: ${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n`);
				break;
			case "patch":
				this._appendToStreaming(`\n\`\`\`diff\n${msg.raw || ""}\n\`\`\`\n`);
				break;
			case "patch_proposed":
				this._showPatchApproval(msg);
				break;
			case "patch_result":
				if (msg.success) {
					toast(`Patch applied to ${msg.filePath || "file"}`, 3000);
				} else {
					toast(`Patch failed: ${msg.error || "unknown error"}`, 3000);
				}
				break;
			case "error":
				this._removeStreamingMessage();
				this._addMessage("assistant", `Error: ${msg.message}`);
				this._setProcessing(false);
				break;
		}
	}

	/**
	 * Handle a streaming chunk (text_delta or streaming status).
	 * @param {object} msg
	 */
	_handleChunk(msg) {
		if (msg.type === "streaming" && msg.status === "started") return;
		if (msg.type === "streaming" && msg.status === "done") {
			this._finalizeStreaming();
			return;
		}
		if (msg.type === "text_delta" && msg.content) {
			this._appendToStreaming(msg.content);
			return;
		}
		if (msg.content) {
			this._appendToStreaming(msg.content);
		}
	}

	/**
	 * Handle patch messages.
	 * @param {object} msg
	 */
	_handlePatch(msg) {
		if (msg.type === "patch_applied" || (msg.type === "patch_result" && msg.success)) {
			toast("Patch applied successfully", 3000);
		} else if (msg.type === "patch_rejected" || (msg.type === "patch_result" && !msg.success)) {
			toast(msg.error || "Patch rejected", 3000);
		}
	}

	/**
	 * Show patch approval buttons in the chat.
	 * @param {object} msg - patch_proposed message with patchId, filePath, old, new
	 */
	_showPatchApproval(msg) {
		const el = document.createElement("div");
		el.className = "ai-chat__message ai-chat__message--assistant ai-chat__message--patch";

		const filePath = msg.filePath || "file";
		const diff = this._computeDiff(msg.old || "", msg.new || "");

		el.innerHTML = `
			<div class="ai-chat__patch-file">Patch: ${this._escapeHtml(filePath)}</div>
			<pre class="ai-chat__patch-diff"><code>${this._escapeHtml(diff)}</code></pre>
			<div class="ai-chat__patch-actions">
				<button class="ai-chat__patch-accept">Accept</button>
				<button class="ai-chat__patch-reject">Reject</button>
			</div>
		`;

		el.querySelector(".ai-chat__patch-accept").addEventListener("click", () => {
			aiWebSocket.send("apply_patch", { patchId: msg.patchId });
			el.querySelector(".ai-chat__patch-actions").innerHTML = '<span class="ai-chat__patch-status">Accepted</span>';
		});

		el.querySelector(".ai-chat__patch-reject").addEventListener("click", () => {
			aiWebSocket.send("reject_patch", { patchId: msg.patchId });
			el.querySelector(".ai-chat__patch-actions").innerHTML = '<span class="ai-chat__patch-status">Rejected</span>';
		});

		this._messagesEl?.appendChild(el);
		this._scrollToBottom();
	}

	/**
	 * Compute a simple unified diff between old and new content.
	 * @param {string} oldText
	 * @param {string} newText
	 * @returns {string}
	 */
	_computeDiff(oldText, newText) {
		const oldLines = oldText.split("\n");
		const newLines = newText.split("\n");
		const diff = [];

		const maxLen = Math.max(oldLines.length, newLines.length);
		for (let i = 0; i < maxLen; i++) {
			if (i >= oldLines.length) {
				diff.push(`+ ${newLines[i]}`);
			} else if (i >= newLines.length) {
				diff.push(`- ${oldLines[i]}`);
			} else if (oldLines[i] !== newLines[i]) {
				diff.push(`- ${oldLines[i]}`);
				diff.push(`+ ${newLines[i]}`);
			}
		}
		return diff.join("\n") || "(no changes)";
	}

	/**
	 * Escape HTML to prevent XSS.
	 * @param {string} str
	 * @returns {string}
	 */
	_escapeHtml(str) {
		const div = document.createElement("div");
		div.textContent = str;
		return div.innerHTML;
	}

	/**
	 * Append text to the streaming message.
	 * @param {string} text
	 */
	_appendToStreaming(text) {
		if (!this._streamingEl) return;
		const contentEl = this._streamingEl.querySelector(".ai-chat__message-content");
		if (!contentEl) return;

		// Remove typing indicator if present
		const typing = contentEl.querySelector(".ai-chat__typing-indicator");
		if (typing) typing.remove();

		contentEl.textContent += text;
		this._scrollToBottom();
	}

	/**
	 * Finalize streaming message and save to history.
	 */
	_finalizeStreaming() {
		if (!this._streamingEl) return;
		const contentEl = this._streamingEl.querySelector(".ai-chat__message-content");

		// Remove typing indicator before extracting content
		const typing = contentEl?.querySelector(".ai-chat__typing-indicator");
		if (typing) typing.remove();

		const content = contentEl?.textContent || "";

		this._streamingEl.classList.remove("ai-chat__message--streaming");
		this._streamingEl = null;

		if (content) {
			this._messages.push({ role: "assistant", content, timestamp: Date.now() });
		}

		this._setProcessing(false);
	}

	/**
	 * Set processing state.
	 * @param {boolean} processing
	 */
	_setProcessing(processing) {
		this._processing = processing;
		if (this._sendBtn) this._sendBtn.disabled = processing;
		if (this._inputEl) this._inputEl.disabled = processing;

		if (processing) {
			this._updateStatus("processing");
		} else {
			this._updateStatus(aiWebSocket.connected ? "connected" : "disconnected");
		}
	}

	/**
	 * Update the status bar.
	 * @param {string} state
	 */
	_updateStatus(state) {
		if (!this._el) return;
		const dot = this._el.querySelector(".ai-chat__status-dot");
		const text = this._el.querySelector(".ai-chat__status-text");
		if (!dot || !text) return;

		dot.className = "ai-chat__status-dot";
		const labels = {
			disconnected: ["Disconnected", "ai-chat__status-dot--disconnected"],
			connected: ["Connected", "ai-chat__status-dot--connected"],
			processing: ["Processing...", "ai-chat__status-dot--processing"],
		};

		const [label, cls] = labels[state] || labels.disconnected;
		text.textContent = label;
		dot.classList.add(cls);
	}

	/**
	 * Scroll messages to the bottom.
	 */
	_scrollToBottom() {
		if (this._messagesEl) {
			this._messagesEl.scrollTop = this._messagesEl.scrollHeight;
		}
	}
}

export default AIChat;
