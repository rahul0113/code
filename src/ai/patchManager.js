/**
 * patchManager.js - Manages file patches (apply/reject).
 *
 * Patches come from OpenClaude output as diff blocks.
 * This module applies them to the actual filesystem.
 */

import fs from "fs";
import path from "path";
import { isPathSafe } from "../lib/claude/storage.js";

const ALLOWED_ROOTS = ["/public", "/home", "/root"];

function isPathWithinWorkspace(filePath) {
	if (!filePath || typeof filePath !== "string") return false;
	const normalized = path.resolve(filePath);
	return ALLOWED_ROOTS.some(
		(root) => normalized === root || normalized.startsWith(root + "/"),
	);
}

class PatchManager {
	constructor() {
		this.pending = new Map();
	}

	/**
	 * Apply a patch to a file.
	 * @param {{ filePath: string, old?: string, new: string }} patch
	 * @returns {{ success: boolean, filePath: string, error?: string }}
	 */
	apply(patch) {
		const { filePath, old, new: newContent } = patch;

		if (!filePath || typeof filePath !== "string" || newContent === undefined) {
			return {
				success: false,
				filePath,
				error: "Invalid patch: missing filePath or new content",
			};
		}

		if (!isPathWithinWorkspace(filePath)) {
			return {
				success: false,
				filePath,
				error: "Path is outside allowed workspace",
			};
		}

		const pathCheck = isPathSafe(filePath);
		if (!pathCheck.safe) {
			return { success: false, filePath, error: pathCheck.reason };
		}

		try {
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			if (old !== null && old !== undefined && fs.existsSync(filePath)) {
				const current = fs.readFileSync(filePath, "utf8");
				if (!current.includes(old)) {
					return {
						success: false,
						filePath,
						error:
							"Original content not found in file. File may have been modified.",
					};
				}
				const updated = current.replaceAll(old, newContent);
				fs.writeFileSync(filePath, updated, "utf8");
			} else {
				fs.writeFileSync(filePath, newContent, "utf8");
			}

			return { success: true, filePath };
		} catch (err) {
			return { success: false, filePath, error: err.message };
		}
	}

	/**
	 * Reject a pending patch (remove from queue).
	 * @param {string} patchId
	 */
	reject(patchId) {
		this.pending.delete(patchId);
	}
}

export { PatchManager };
