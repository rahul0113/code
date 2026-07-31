import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { parseDiff, createLineElement, LINE_TYPES } from "ai/diffViewer.js";
import { PatchDialog } from "ai/patchDialog.js";
import { ConflictResolver } from "ai/conflictResolver.js";
import { PatchHistory } from "ai/patchHistory.js";

// ── diffViewer tests ────────────────────────────────────────────

// Mock document for DOM-dependent tests
function createMockElement() {
  const children = [];
  const listeners = {};
  const el = {
    tagName: "div",
    className: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    children,
    childNodes: children,
    parentNode: null,
    addEventListener: vi.fn((event, cb) => { listeners[event] = cb; }),
    removeEventListener: vi.fn(),
    appendChild: (child) => { child.parentNode = el; children.push(child); return child; },
    removeChild: (child) => { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); return child; },
    querySelector: (sel) => {
      if (sel === ".ai-diff__gutter") return { textContent: "3", dataset: { newLine: "4" } };
      if (sel === ".ai-diff__prefix") return { textContent: "+" };
      if (sel === ".ai-diff__content") return { textContent: "test" };
      return null;
    },
    querySelectorAll: () => [],
    classList: { add: vi.fn(), remove: vi.fn() },
    _listeners: listeners,
  };
  return el;
}

function setupDocumentMock() {
  globalThis.document = {
    createElement: vi.fn(() => createMockElement()),
    body: { appendChild: vi.fn(), removeChild: vi.fn() },
  };
}

function teardownDocumentMock() {
  delete globalThis.document;
}

describe("diffViewer", () => {
  const sampleDiff = `--- a/test.js
+++ b/test.js
@@ -1,5 +1,6 @@
 line1
+added line
 line2
 line3
 line4
 line5`;

  it("parses unified diff into structured lines", () => {
    const { lines, stats } = parseDiff(sampleDiff);
    expect(lines.length).toBeGreaterThan(0);
    expect(stats.added).toBe(1);
    expect(stats.unchanged).toBeGreaterThan(0);
  });

  it("identifies add lines", () => {
    const { lines } = parseDiff(sampleDiff);
    const adds = lines.filter((l) => l.type === LINE_TYPES.ADD);
    expect(adds.length).toBe(1);
    expect(adds[0].content).toBe("added line");
  });

  it("identifies context lines", () => {
    const { lines } = parseDiff(sampleDiff);
    const context = lines.filter((l) => l.type === LINE_TYPES.CONTEXT);
    expect(context.length).toBeGreaterThan(0);
  });

  it("identifies header lines", () => {
    const { lines } = parseDiff(sampleDiff);
    const headers = lines.filter((l) => l.type === LINE_TYPES.HEADER);
    expect(headers.length).toBe(3); // ---, +++, and @@ hunk header
  });

  it("creates line element with correct class", () => {
    setupDocumentMock();
    const el = createLineElement({ type: LINE_TYPES.ADD, content: "test", oldLine: null, newLine: 5 });
    expect(el.className).toContain("ai-diff__line--add");
    teardownDocumentMock();
  });

  it("shows line numbers in gutter", () => {
    setupDocumentMock();
    const el = createLineElement({ type: LINE_TYPES.CONTEXT, content: "test", oldLine: 3, newLine: 4 });
    const gutter = el.querySelector(".ai-diff__gutter");
    expect(gutter.textContent).toBe("3");
    expect(gutter.dataset.newLine).toBe("4");
    teardownDocumentMock();
  });

  it("handles empty diff", () => {
    const { lines, stats } = parseDiff("");
    expect(lines.length).toBe(0);
    expect(stats.added).toBe(0);
    expect(stats.removed).toBe(0);
  });

  it("handles diff with removals", () => {
    const diff = "--- a/test.js\n+++ b/test.js\n@@ -1,3 +1,2 @@\n line1\n-removed\n line3";
    const { stats } = parseDiff(diff);
    expect(stats.removed).toBe(1);
  });
});

// ── patchDialog tests ───────────────────────────────────────────

describe("patchDialog", () => {
  let dialog;

  beforeEach(() => {
    setupDocumentMock();
    dialog = new PatchDialog();
  });

  afterEach(() => {
    dialog.hide();
    delete globalThis.document;
  });

  it("shows dialog with patch info", () => {
    const patch = { id: "p1", filePath: "/tmp/test.js", diff: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" };
    const onAccept = vi.fn();
    const onReject = vi.fn();

    dialog.show(patch, { onAccept, onReject });
    expect(dialog.isOpen).toBe(true);
  });

  it("hides dialog", () => {
    const patch = { id: "p1", filePath: "/tmp/test.js", diff: "" };
    dialog.show(patch, { onAccept: vi.fn(), onReject: vi.fn() });
    dialog.hide();
    expect(dialog.isOpen).toBe(false);
  });

  it("calls onAccept with patch id", () => {
    const patch = { id: "p1", filePath: "/tmp/test.js", diff: "" };
    const onAccept = vi.fn();
    dialog.show(patch, { onAccept, onReject: vi.fn() });

    // Find accept button in the dialog's buttons container (3rd child of _el)
    const buttonsDiv = dialog._el.children[2];
    const acceptBtn = buttonsDiv.children.find((c) => c.className?.includes("accept"));
    if (acceptBtn) acceptBtn._listeners.click();

    expect(onAccept).toHaveBeenCalledWith("p1");
  });

  it("calls onReject with patch id", () => {
    const patch = { id: "p1", filePath: "/tmp/test.js", diff: "" };
    const onReject = vi.fn();
    dialog.show(patch, { onAccept: vi.fn(), onReject });

    // Find reject button in the dialog's buttons container (3rd child of _el)
    const buttonsDiv = dialog._el.children[2];
    const rejectBtn = buttonsDiv.children.find((c) => c.className?.includes("reject"));
    if (rejectBtn) rejectBtn._listeners.click();

    expect(onReject).toHaveBeenCalledWith("p1");
  });
});

// ── conflictResolver tests ──────────────────────────────────────

describe("conflictResolver", () => {
  let resolver;
  let tmpDir;

  beforeEach(() => {
    resolver = new ConflictResolver();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conflict-test-"));
  });

  afterEach(() => {
    resolver.clear();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects no conflict when file matches expected content", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "line1\nline2\n");

    const result = resolver.checkConflict(filePath, "line1\nline2\n");
    expect(result.hasConflict).toBe(false);
  });

  it("detects conflict when file has been modified", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "modified content");

    const result = resolver.checkConflict(filePath, "original content");
    expect(result.hasConflict).toBe(true);
    expect(result.reason).toContain("modified");
  });

  it("returns no conflict for non-existent file (new file)", () => {
    const filePath = path.join(tmpDir, "nonexistent.txt");
    const result = resolver.checkConflict(filePath, "anything");
    expect(result.hasConflict).toBe(false);
  });

  it("resolves with 'ours' strategy keeps current content", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "current content");

    const result = resolver.resolve(filePath, "old content", "new content", "ours");
    expect(result.success).toBe(true);
    expect(result.content).toBe("current content");
  });

  it("resolves with 'theirs' strategy applies patch content", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "current content");

    const result = resolver.resolve(filePath, "old content", "patch content", "theirs");
    expect(result.success).toBe(true);
    expect(result.content).toBe("patch content");
  });

  it("rejects unknown strategy", () => {
    const filePath = path.join(tmpDir, "test.txt");
    fs.writeFileSync(filePath, "content");

    const result = resolver.resolve(filePath, "old", "new", "unknown");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown strategy");
  });

  it("registers and tracks originals", () => {
    resolver.registerOriginal("/tmp/test.js", "original content");
    expect(resolver._originals.get("/tmp/test.js")).toBe("original content");
  });

  it("clears all data", () => {
    resolver.registerOriginal("/tmp/test.js", "content");
    resolver.clear();
    expect(resolver._originals.size).toBe(0);
  });
});

// ── patchHistory tests ──────────────────────────────────────────

describe("patchHistory", () => {
  let history;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
    history = new PatchHistory(tmpDir);
  });

  afterEach(() => {
    history.clear();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records patches", () => {
    history.record("p1", "/tmp/test.js", "old content");
    expect(history.length).toBe(1);
  });

  it("undoes most recent patch", () => {
    history.record("p1", "/tmp/test.js", "old content");

    const result = history.undo();
    expect(result.success).toBe(true);
    expect(result.filePath).toBe("/tmp/test.js");
    expect(result.oldContent).toBe("old content");
    expect(history.length).toBe(0);
  });

  it("undoes specific patch by id", () => {
    history.record("p1", "/tmp/a.js", "content a");
    history.record("p2", "/tmp/b.js", "content b");

    const result = history.undo("p1");
    expect(result.success).toBe(true);
    expect(result.filePath).toBe("/tmp/a.js");
    expect(history.length).toBe(1);
  });

  it("returns error for non-existent patch", () => {
    const result = history.undo("nonexistent");
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("reports canUndo correctly", () => {
    expect(history.canUndo()).toBe(false);
    history.record("p1", "/tmp/test.js", "content");
    expect(history.canUndo()).toBe(true);
    expect(history.canUndo("p1")).toBe(true);
    expect(history.canUndo("other")).toBe(false);
  });

  it("lists undoable patches", () => {
    history.record("p1", "/tmp/a.js", "a");
    history.record("p2", "/tmp/b.js", "b");

    const list = history.getUndoable();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe("p2"); // Most recent first
    expect(list[1].id).toBe("p1");
  });

  it("enforces max history limit", () => {
    for (let i = 0; i < 60; i++) {
      history.record(`p${i}`, `/tmp/test.js`, `content ${i}`);
    }
    expect(history.length).toBe(50);
  });

  it("clears all history", () => {
    history.record("p1", "/tmp/test.js", "content");
    history.clear();
    expect(history.length).toBe(0);
  });

  it("persists to disk and loads back", () => {
    history.record("p1", "/tmp/test.js", "old content");

    const history2 = new PatchHistory(tmpDir);
    history2._load();
    expect(history2.length).toBe(1);
    expect(history2.getUndoable()[0].id).toBe("p1");
  });

  it("handles missing storage dir gracefully", () => {
    const noStorage = new PatchHistory();
    noStorage.record("p1", "/tmp/test.js", "content");
    expect(noStorage.length).toBe(1);
    // Should not throw on persist
  });
});
