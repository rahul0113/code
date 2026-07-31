/**
 * conversationStore.js - Persists chat conversations across sessions.
 *
 * Stores conversation history (messages, timestamps, metadata) using
 * localStorage so users can resume where they left off.
 */

const STORAGE_KEY = "ai_conversations";
const MAX_CONVERSATIONS = 20;
const MAX_MESSAGES_PER_CONVERSATION = 200;

class ConversationStore {
  constructor() {
    /** @type {Array<{id: string, title: string, messages: object[], createdAt: number, updatedAt: number}>} */
    this._conversations = [];
    /** @type {string|null} */
    this._activeId = null;
  }

  /**
   * Load conversations from storage.
   */
  load() {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      if (raw) {
        this._conversations = JSON.parse(raw);
      }
    } catch {
      this._conversations = [];
    }
  }

  /**
   * Save conversations to storage.
   */
  _save() {
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this._conversations));
    } catch { /* storage may be full */ }
  }

  /**
   * Get all conversations.
   * @returns {Array<{id: string, title: string, messageCount: number, updatedAt: number}>}
   */
  list() {
    return this._conversations.map((c) => ({
      id: c.id,
      title: c.title,
      messageCount: c.messages.length,
      updatedAt: c.updatedAt,
    }));
  }

  /**
   * Get a conversation by ID.
   * @param {string} id
   * @returns {object|null}
   */
  get(id) {
    return this._conversations.find((c) => c.id === id) || null;
  }

  /**
   * Get the active conversation.
   * @returns {object|null}
   */
  getActive() {
    if (!this._activeId) return null;
    return this.get(this._activeId);
  }

  /**
   * Get the active conversation ID.
   * @returns {string|null}
   */
  getActiveId() {
    return this._activeId;
  }

  /**
   * Set the active conversation.
   * @param {string|null} id
   */
  setActive(id) {
    this._activeId = id;
  }

  /**
   * Create a new conversation.
   * @param {string} [title] - Auto-generated if not provided
   * @returns {object} The new conversation
   */
  create(title) {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const conversation = {
      id,
      title: title || `Chat ${new Date().toLocaleDateString()}`,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this._conversations.unshift(conversation);

    // Enforce limit
    while (this._conversations.length > MAX_CONVERSATIONS) {
      this._conversations.pop();
    }

    this._activeId = id;
    this._save();
    return conversation;
  }

  /**
   * Add a message to a conversation.
   * @param {string} conversationId
   * @param {"user"|"assistant"} role
   * @param {string} content
   */
  addMessage(conversationId, role, content) {
    const conv = this.get(conversationId);
    if (!conv) return;

    conv.messages.push({
      role,
      content,
      timestamp: Date.now(),
    });

    // Cap messages
    if (conv.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      conv.messages = conv.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
    }

    // Auto-title from first user message
    if (role === "user" && conv.messages.filter((m) => m.role === "user").length === 1) {
      conv.title = content.slice(0, 60) + (content.length > 60 ? "..." : "");
    }

    conv.updatedAt = Date.now();
    this._save();
  }

  /**
   * Delete a conversation.
   * @param {string} id
   */
  delete(id) {
    this._conversations = this._conversations.filter((c) => c.id !== id);
    if (this._activeId === id) {
      this._activeId = this._conversations[0]?.id || null;
    }
    this._save();
  }

  /**
   * Clear all conversations.
   */
  clear() {
    this._conversations = [];
    this._activeId = null;
    this._save();
  }

  /**
   * Get the messages for a conversation.
   * @param {string} id
   * @returns {Array<{role: string, content: string, timestamp: number}>}
   */
  getMessages(id) {
    const conv = this.get(id);
    return conv ? [...conv.messages] : [];
  }
}

export { ConversationStore };
