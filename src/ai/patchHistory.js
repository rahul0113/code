/**
 * patchHistory.js - Undo support for applied patches.
 *
 * Stores previous file contents before patches are applied,
 * allowing users to undo changes and revert to prior state.
 */

import fs from "fs";

const MAX_HISTORY = 50;

class PatchHistory {
	/**
	 * @param {string} [storageDir] - Directory to persist undo history (optional)
	 */
	constructor(storageDir) {
		/** @type {Array<{id: string, filePath: string, oldContent: string, timestamp: number, description: string}>} */
		this._stack = [];
		/** @type {string|undefined} */
		this._storageDir = storageDir;
	}

	/**
	 * Record a patch before it is applied.
	 * @param {string} patchId
	 * @param {string} filePath
	 * @param {string} oldContent - File content before the patch
	 * @param {string} [description] - Human-readable description
	 */
	record(patchId, filePath, oldContent, description = "") {
		this._stack.unshift({
			id: patchId,
			filePath,
			oldContent,
			timestamp: Date.now(),
			description,
		});

		// Trim to max history
		if (this._stack.length > MAX_HISTORY) {
			this._stack = this._stack.slice(0, MAX_HISTORY);
		}

		this._persist();
	}

	/**
	 * Undo the most recent patch for a specific file, or the most recent overall.
	 * @param {string} [patchId] - Specific patch ID to undo, or undefined for most recent
	 * @returns {{ success: boolean, filePath: string|null, oldContent: string|null, error: string|null }}
	 */
	undo(patchId) {
		let index;
		if (patchId) {
			index = this._stack.findIndex((e) => e.id === patchId);
		} else {
			index = 0;
		}

		if (index === -1 || index >= this._stack.length) {
			return {
				success: false,
				filePath: null,
				oldContent: null,
				error: "Patch not found in history",
			};
		}

		const entry = this._stack[index];

		// Remove from history
		this._stack.splice(index, 1);
		this._persist();

		return {
			success: true,
			filePath: entry.filePath,
			oldContent: entry.oldContent,
			error: null,
		};
	}

	/**
	 * Check if there is an undo available.
	 * @param {string} [patchId]
	 * @returns {boolean}
	 */
	canUndo(patchId) {
		if (patchId) {
			return this._stack.some((e) => e.id === patchId);
		}
		return this._stack.length > 0;
	}

	/**
	 * Get the list of undoable patches.
	 * @returns {Array<{id: string, filePath: string, timestamp: number, description: string}>}
	 */
	getUndoable() {
		return this._stack.map((e) => ({
			id: e.id,
			filePath: e.filePath,
			timestamp: e.timestamp,
			description: e.description,
		}));
	}

	/**
	 * Clear all history.
	 */
	clear() {
		this._stack = [];
		this._persist();
	}

	/** @returns {number} Number of undoable patches */
	get length() {
		return this._stack.length;
	}

	_persist() {
		if (!this._storageDir) return;
		try {
			const data = JSON.stringify(this._stack);
			fs.writeFileSync(`${this._storageDir}/patch-history.json`, data, "utf8");
		} catch {
			// Silently fail on write errors
		}
	}

	_load() {
		if (!this._storageDir) return;
		try {
			const data = fs.readFileSync(
				`${this._storageDir}/patch-history.json`,
				"utf8",
			);
			this._stack = JSON.parse(data);
		} catch {
			this._stack = [];
		}
	}
}

export { PatchHistory };
