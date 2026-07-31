/**
 * patchDialog.js - Patch review dialog for AI-generated changes.
 *
 * Shows a diff view with accept/reject buttons.
 * Emits events for the message router to handle patch application.
 */

import { createDiffViewer } from "./diffViewer.js";

class PatchDialog {
  constructor() {
    /** @type {HTMLElement|null} */
    this._el = null;
    /** @type {HTMLElement|null} */
    this._overlay = null;
    /** @type {object|null} */
    this._currentPatch = null;
    /** @type {Function|null} */
    this._onAccept = null;
    /** @type {Function|null} */
    this._onReject = null;
  }

  /**
   * Show the patch dialog.
   * @param {object} patch - { id, filePath, diff, oldContent, newContent }
   * @param {{ onAccept: Function, onReject: Function }} callbacks
   */
  show(patch, { onAccept, onReject }) {
    this.hide(); // Close any existing dialog

    this._currentPatch = patch;
    this._onAccept = onAccept;
    this._onReject = onReject;

    // Create overlay
    this._overlay = document.createElement("div");
    this._overlay.className = "ai-patch-overlay";
    this._overlay.addEventListener("click", (e) => {
      if (e.target === this._overlay) this.hide();
    });

    // Dialog container
    this._el = document.createElement("div");
    this._el.className = "ai-patch-dialog";

    // Header
    const header = document.createElement("div");
    header.className = "ai-patch-dialog__header";

    const title = document.createElement("h3");
    title.className = "ai-patch-dialog__title";
    title.textContent = "Review Patch";

    const filePath = document.createElement("span");
    filePath.className = "ai-patch-dialog__file";
    filePath.textContent = patch.filePath;

    header.appendChild(title);
    header.appendChild(filePath);
    this._el.appendChild(header);

    // Diff content
    const diffContainer = document.createElement("div");
    diffContainer.className = "ai-patch-dialog__diff";

    if (patch.diff) {
      const { element } = createDiffViewer(patch.diff);
      diffContainer.appendChild(element);
    } else if (patch.oldContent !== undefined && patch.newContent !== undefined) {
      // Generate a simple diff from old/new content
      const diff = this._generateSimpleDiff(patch.oldContent, patch.newContent);
      const { element } = createDiffViewer(diff);
      diffContainer.appendChild(element);
    }

    this._el.appendChild(diffContainer);

    // Buttons
    const buttons = document.createElement("div");
    buttons.className = "ai-patch-dialog__buttons";

    const rejectBtn = document.createElement("button");
    rejectBtn.className = "ai-patch-dialog__btn ai-patch-dialog__btn--reject";
    rejectBtn.textContent = "Reject";
    rejectBtn.addEventListener("click", () => this._handleReject());

    const acceptBtn = document.createElement("button");
    acceptBtn.className = "ai-patch-dialog__btn ai-patch-dialog__btn--accept";
    acceptBtn.textContent = "Accept";
    acceptBtn.addEventListener("click", () => this._handleAccept());

    buttons.appendChild(rejectBtn);
    buttons.appendChild(acceptBtn);
    this._el.appendChild(buttons);

    this._overlay.appendChild(this._el);
    document.body.appendChild(this._overlay);
  }

  /**
   * Hide and clean up the dialog.
   */
  hide() {
    if (this._overlay && this._overlay.parentNode) {
      this._overlay.parentNode.removeChild(this._overlay);
    }
    this._overlay = null;
    this._el = null;
    this._currentPatch = null;
    this._onAccept = null;
    this._onReject = null;
  }

  _handleAccept() {
    if (this._currentPatch && this._onAccept) {
      this._onAccept(this._currentPatch.id);
    }
    this.hide();
  }

  _handleReject() {
    if (this._currentPatch && this._onReject) {
      this._onReject(this._currentPatch.id);
    }
    this.hide();
  }

  /**
   * Generate a basic line-by-line diff from old and new content.
   * @param {string} oldContent
   * @param {string} newContent
   * @returns {string}
   */
  _generateSimpleDiff(oldContent, newContent) {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");
    const diff = ["--- old", "+++ new"];

    const maxLen = Math.max(oldLines.length, newLines.length);
    let oldLine = 1;
    let newLine = 1;
    let hunks = [];
    let currentHunk = null;

    for (let i = 0; i < maxLen; i++) {
      const oldLineContent = i < oldLines.length ? oldLines[i] : undefined;
      const newLineContent = i < newLines.length ? newLines[i] : undefined;

      if (oldLineContent === newLineContent) {
        if (currentHunk) {
          hunks.push(currentHunk);
          currentHunk = null;
        }
        oldLine++;
        newLine++;
        continue;
      }

      if (!currentHunk) {
        currentHunk = { start: oldLine, lines: [] };
      }

      if (oldLineContent !== undefined) {
        currentHunk.lines.push(`-${oldLineContent}`);
        oldLine++;
      }
      if (newLineContent !== undefined) {
        currentHunk.lines.push(`+${newLineContent}`);
        newLine++;
      }
    }

    if (currentHunk) {
      hunks.push(currentHunk);
    }

    for (const hunk of hunks) {
      diff.push(`@@ -${hunk.start} +${hunk.start} @@`);
      diff.push(...hunk.lines);
    }

    return diff.join("\n");
  }

  /** @returns {boolean} Whether the dialog is currently open */
  get isOpen() {
    return this._overlay !== null;
  }
}

export { PatchDialog };
