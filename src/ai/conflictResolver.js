/**
 * conflictResolver.js - Detects and resolves patch conflicts.
 *
 * When a patch targets a file that has been modified since the patch was created,
 * this module detects the conflict and offers resolution strategies.
 */

import fs from "fs";

class ConflictResolver {
	constructor() {
		/** @type {Map<string, string>} Original file contents at patch creation time */
		this._originals = new Map();
	}

	/**
	 * Register the expected file content when a patch is created.
	 * @param {string} filePath
	 * @param {string} content
	 */
	registerOriginal(filePath, content) {
		this._originals.set(filePath, content);
	}

	/**
	 * Check if a patch conflicts with the current file state.
	 * @param {string} filePath
	 * @param {string} expectedOld - The old content the patch expects
	 * @returns {{ hasConflict: boolean, reason: string, resolution: string|null }}
	 */
	checkConflict(filePath, expectedOld) {
		// File doesn't exist yet — no conflict (it's a new file)
		if (!fs.existsSync(filePath)) {
			return { hasConflict: false, reason: "", resolution: null };
		}

		const currentContent = fs.readFileSync(filePath, "utf8");

		// No conflict: current file matches what the patch expects
		if (currentContent === expectedOld) {
			return { hasConflict: false, reason: "", resolution: null };
		}

		// Conflict: file has been modified
		const registered = this._originals.get(filePath);
		if (registered && currentContent === registered) {
			// File is unchanged from when we first saw it, but patch expects different old content
			return {
				hasConflict: true,
				reason: "File content does not match the patch's expected state",
				resolution: null,
			};
		}

		return {
			hasConflict: true,
			reason: "File has been modified since the patch was created",
			resolution: null,
		};
	}

	/**
	 * Attempt to resolve a conflict using a strategy.
	 * @param {string} filePath
	 * @param {string} expectedOld - The old content the patch expects
	 * @param {string} newContent - The new content from the patch
	 * @param {"ours"|"theirs"|"merge"} strategy
	 * @returns {{ success: boolean, content: string|null, error: string|null }}
	 */
	resolve(filePath, expectedOld, newContent, strategy) {
		const currentContent = fs.readFileSync(filePath, "utf8");

		switch (strategy) {
			case "ours":
				// Keep current file, ignore patch
				return { success: true, content: currentContent, error: null };

			case "theirs":
				// Force apply patch content (discard local changes)
				return { success: true, content: newContent, error: null };

			case "merge":
				// Try simple line-based merge
				return this._threeWayMerge(filePath, expectedOld, newContent);

			default:
				return {
					success: false,
					content: null,
					error: `Unknown strategy: ${strategy}`,
				};
		}
	}

	/**
	 * Simple three-way merge: base (expectedOld), current, and theirs (newContent).
	 * Uses line-level comparison for non-conflicting changes.
	 * @param {string} filePath
	 * @param {string} base
	 * @param {string} theirs
	 * @returns {{ success: boolean, content: string|null, error: string|null }}
	 */
	_threeWayMerge(filePath, base, theirs) {
		const current = fs.readFileSync(filePath, "utf8");
		const baseLines = base.split("\n");
		const currentLines = current.split("\n");
		const theirsLines = theirs.split("\n");

		// Simple approach: find changed regions in both and combine
		const merged = [...currentLines];
		const baseChanged = this._diffLines(baseLines, theirsLines);
		const currentChanged = this._diffLines(baseLines, currentLines);

		// Check for overlapping changes
		const conflicts = [];
		for (const change of baseChanged) {
			for (const current of currentChanged) {
				if (this._rangesOverlap(change, current)) {
					conflicts.push({ base: change, current });
				}
			}
		}

		if (conflicts.length > 0) {
			return {
				success: false,
				content: null,
				error: `Merge conflict: ${conflicts.length} overlapping change(s) detected`,
			};
		}

		// Apply non-conflicting changes from theirs
		for (const change of baseChanged) {
			if (!currentChanged.some((c) => this._rangesOverlap(change, c))) {
				merged.splice(
					change.start,
					change.end - change.start + 1,
					...change.lines,
				);
			}
		}

		return { success: true, content: merged.join("\n"), error: null };
	}

	/**
	 * Find line-level differences between two versions.
	 * @param {string[]} a
	 * @param {string[]} b
	 * @returns {Array<{start: number, end: number, lines: string[]}>}
	 */
	_diffLines(a, b) {
		const changes = [];
		const maxLen = Math.max(a.length, b.length);
		let i = 0;

		while (i < maxLen) {
			if (a[i] !== b[i]) {
				const start = i;
				while (i < maxLen && a[i] !== b[i]) {
					i++;
				}
				changes.push({
					start,
					end: i - 1,
					lines: b.slice(start, i),
				});
			} else {
				i++;
			}
		}

		return changes;
	}

	/**
	 * Check if two ranges overlap.
	 * @param {{ start: number, end: number }} a
	 * @param {{ start: number, end: number }} b
	 * @returns {boolean}
	 */
	_rangesOverlap(a, b) {
		return a.start <= b.end && b.start <= a.end;
	}

	/**
	 * Clear registered originals.
	 */
	clear() {
		this._originals.clear();
	}
}

export { ConflictResolver };
