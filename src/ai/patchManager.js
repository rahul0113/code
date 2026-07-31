/**
 * patchManager.js - Manages file patches (apply/reject).
 *
 * Patches come from OpenClaude output as diff blocks.
 * This module applies them to the actual filesystem.
 */

const fs = require("fs");
const path = require("path");

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

    if (!filePath || newContent === undefined) {
      return { success: false, filePath, error: "Invalid patch: missing filePath or new content" };
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
            error: "Original content not found in file. File may have been modified.",
          };
        }
        const updated = current.replace(old, newContent);
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

module.exports = { PatchManager };
