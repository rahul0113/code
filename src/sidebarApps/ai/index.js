/**
 * AI Chat sidebar app for Acode.
 *
 * Registers the AI coding assistant as a sidebar panel.
 * Uses WebSocket to communicate with the backend running in the sandbox.
 */

import "./style.scss";
import AIChat from "./chat";

let chat = null;

export default [
	"brain", // icon
	"ai-chat", // id
	"AI Chat", // title
	initApp, // init function
	false, // prepend
	onSelected, // onSelected function
];

/**
 * Initialize the AI chat sidebar app.
 * @param {HTMLElement} el - Container element
 * @returns {Function} cleanup function
 */
function initApp(el) {
	chat = new AIChat();
	return chat.create(el);
}

/**
 * Called when the AI chat tab is selected.
 */
function onSelected() {
	// Focus the input when the tab is activated
	if (chat && chat._inputEl) {
		chat._inputEl.focus();
	}
}
