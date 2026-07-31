/**
 * chat.js - Chat UI for the AI coding assistant.
 *
 * Renders the message list, input box, and send button.
 * Handles streaming display and markdown rendering.
 */

import toast from "src/components/toast";
import aiWebSocket from "src/ai/websocket";

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

		this._handleSend = this._handleSend.bind(this);
		this._handleCancel = this._handleCancel.bind(this);
		this._handleKeydown = this._handleKeydown.bind(this);
	}

	/**
	 * Create the chat UI inside a container element.
	 * @param {HTMLElement} container
	 * @returns {Function} cleanup function
	 */
	create(container) {
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

		// WebSocket callbacks
		aiWebSocket.onMessage((msg) => this._handleServerMessage(msg));
		aiWebSocket.onChunk((msg) => this._handleChunk(msg));
		aiWebSocket.onPatch((msg) => this._handlePatch(msg));
		aiWebSocket.onError(() => {
			this._setProcessing(false);
			toast("Connection error", 3000);
		});
		aiWebSocket.onDisconnect(() => {
			this._setProcessing(false);
			this._updateStatus("disconnected");
		});
		aiWebSocket.onConnect(() => {
			this._updateStatus("connected");
		});

		// Auto-connect
		aiWebSocket.connect()
			.then(() => aiWebSocket.connectBackend())
			.catch(() => {});

		return () => {
			this._sendBtn.removeEventListener("click", this._handleSend);
			this._cancelBtn.removeEventListener("click", this._handleCancel);
			this._inputEl.removeEventListener("keydown", this._handleKeydown);
			aiWebSocket.disconnect();
		};
	}

	/**
	 * Handle sending a message.
	 */
	async _handleSend() {
		const text = this._inputEl.value.trim();
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

		this._inputEl.value = "";
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
		this._setProcessing(false);
	}

	/**
	 * Handle Enter key in input.
	 * @param {KeyboardEvent} e
	 */
	_handleKeydown(e) {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			this._handleSend();
		}
	}

	/**
	 * Add a message to the chat.
	 * @param {"user"|"assistant"} role
	 * @param {string} content
	 */
	_addMessage(role, content) {
		// Remove welcome message
		const welcome = this._messagesEl.querySelector(".ai-chat__welcome");
		if (welcome) welcome.remove();

		const msg = { role, content, timestamp: Date.now() };
		this._messages.push(msg);

		const el = <div className={`ai-chat__message ai-chat__message--${role}`}>
			<div className="ai-chat__message-content md">{content}</div>
		</div>;
		this._messagesEl.appendChild(el);
		this._scrollToBottom();
	}

	/**
	 * Create a streaming message placeholder for AI response.
	 */
	_createStreamingMessage() {
		this._streamingEl = <div className="ai-chat__message ai-chat__message--assistant ai-chat__message--streaming">
			<div className="ai-chat__message-content md">
				<div className="ai-chat__typing-indicator">
					<span></span><span></span><span></span>
				</div>
			</div>
		</div>;
		this._messagesEl.appendChild(this._streamingEl);
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
	 * Handle a server message (text, tool_call, patch, error).
	 * @param {object} msg
	 */
	_handleServerMessage(msg) {
		switch (msg.type) {
			case "text":
				this._appendToStreaming(msg.content || msg.text || "");
				break;
			case "tool_call":
				this._appendToStreaming(`\n\`\`\`\nTool: ${msg.name}\nInput: ${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n`);
				break;
			case "patch":
				this._appendToStreaming(`\n\`\`\`diff\n${msg.raw || ""}\n\`\`\`\n`);
				break;
			case "error":
				this._removeStreamingMessage();
				this._addMessage("assistant", `Error: ${msg.message}`);
				this._setProcessing(false);
				break;
		}
	}

	/**
	 * Handle a streaming chunk.
	 * @param {object} msg
	 */
	_handleChunk(msg) {
		if (msg.status === "started") return;
		if (msg.status === "done") {
			this._finalizeStreaming();
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
		if (msg.type === "patch_applied") {
			toast("Patch applied successfully", 3000);
		} else if (msg.type === "patch_rejected") {
			toast("Patch rejected", 3000);
		}
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
