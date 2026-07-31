/**
 * status.js - Connection status bar for the AI chat panel.
 *
 * Shows connected/disconnected/processing state with a visual indicator.
 */

const STATUS_CLASSES = {
	disconnected: "ai-status--disconnected",
	connected: "ai-status--connected",
	processing: "ai-status--processing",
};

class AIStatus {
	constructor() {
		/** @type {HTMLElement|null} */
		this._el = null;
		/** @type {HTMLElement|null} */
		this._dot = null;
		/** @type {HTMLElement|null} */
		this._text = null;
		/** @type {string} */
		this._state = "disconnected";
	}

	/**
	 * Create the status bar element.
	 * @returns {HTMLElement}
	 */
	create() {
		this._el = (
			<div className="ai-status">
				<span className="ai-status__dot"></span>
				<span className="ai-status__text">Disconnected</span>
			</div>
		);
		this._dot = this._el.querySelector(".ai-status__dot");
		this._text = this._el.querySelector(".ai-status__text");
		this.setState("disconnected");
		return this._el;
	}

	/**
	 * Update the connection state.
	 * @param {"disconnected"|"connected"|"processing"} state
	 */
	setState(state) {
		this._state = state;
		if (!this._el) return;

		// Remove all state classes
		Object.values(STATUS_CLASSES).forEach((cls) => {
			this._el.classList.remove(cls);
		});

		// Add current state class
		this._el.classList.add(STATUS_CLASSES[state]);

		// Update text
		const labels = {
			disconnected: "Disconnected",
			connected: "Connected",
			processing: "Processing...",
		};
		this._text.textContent = labels[state];
	}

	/** @returns {string} Current state */
	get state() {
		return this._state;
	}
}

export default AIStatus;
