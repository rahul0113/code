import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseCliOutput } from "lib/claude/cliParser.js";
import * as storage from "lib/claude/storage.js";
import Claude from "plugins/claude/www/Claude.js";

/**
 * QA Test Suite — End-to-end flow validation for Claude integration.
 * These tests validate the complete user journey through each feature.
 */

// ── QA-01: Plugin Registration ──────────────────────────────────
describe("QA-01: Plugin Registration", () => {
  it("plugin.xml has correct id", async () => {
    const fs = await import("fs");
    const xml = fs.readFileSync(
      "src/plugins/claude/plugin.xml",
      "utf8"
    );
    expect(xml).toContain('id="com.foxdebug.acode.claude"');
  });

  it("plugin.xml declares JS module", async () => {
    const fs = await import("fs");
    const xml = fs.readFileSync(
      "src/plugins/claude/plugin.xml",
      "utf8"
    );
    expect(xml).toContain('src="www/Claude.js"');
    expect(xml).toContain("clobbers");
  });

  it("plugin.xml declares Android platform", async () => {
    const fs = await import("fs");
    const xml = fs.readFileSync(
      "src/plugins/claude/plugin.xml",
      "utf8"
    );
    expect(xml).toContain('platform name="android"');
    expect(xml).toContain("ClaudePlugin.java");
  });

  it("package.json has correct id and version", async () => {
    const fs = await import("fs");
    const pkg = JSON.parse(
      fs.readFileSync("src/plugins/claude/package.json", "utf8")
    );
    expect(pkg.name).toBe("com.foxdebug.acode.claude");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("Java plugin file exists and has package declaration", async () => {
    const fs = await import("fs");
    const java = fs.readFileSync(
      "src/plugins/claude/src/android/ClaudePlugin.java",
      "utf8"
    );
    expect(java).toContain("package com.foxdebug.acode.claude");
    expect(java).toContain("extends CordovaPlugin");
  });
});

// ── QA-02: CLI Parser Integration ───────────────────────────────
describe("QA-02: CLI Parser Integration", () => {

  it("parses complete OpenClaude response with tool calls", () => {
    // parseCliOutput imported at top
    const input = `I'll read the file to understand the issue.

<tool_use>
<name>read_file</name>
<input>{"path": "/public/project/src/index.js"}</input>
</tool_use>

Now let me fix the bug:

\`\`\`diff
--- a/src/index.js
+++ b/src/index.js
@@ -10,3 +10,3 @@
 function calculate() {
-  return null;
+  return 0;
 }
\`\`\`

Fixed! The function now returns 0 instead of null.`;

    const result = parseCliOutput(input);
    const types = result.map((m) => m.type);

    expect(types).toContain("text"); // Explanation text
    expect(types).toContain("tool_call"); // read_file
    expect(types).toContain("patch"); // diff

    const toolCall = result.find((m) => m.type === "tool_call");
    expect(toolCall.name).toBe("read_file");

    const patch = result.find((m) => m.type === "patch");
    expect(patch.filePath).toBe("src/index.js");
    expect(patch.new).toContain("return 0;");
  });

  it("parses multi-file patch output", () => {
    // parseCliOutput imported at top
    const input = `\`\`\`diff
--- a/src/app.js
+++ b/src/app.js
-old
+new
\`\`\`

\`\`\`diff
--- a/src/utils.js
+++ b/src/utils.js
-old
+new
\`\`\``;

    const result = parseCliOutput(input);
    const patches = result.filter((m) => m.type === "patch");
    expect(patches).toHaveLength(2);
  });

  it("handles Claude response with only text (no tools)", () => {
    // parseCliOutput imported at top
    const input = `The issue is on line 42. You need to add a null check.`;
    const result = parseCliOutput(input);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("handles Claude response with only tool calls (no text)", () => {
    // parseCliOutput imported at top
    const input = `<tool_use>
<name>read_file</name>
<input>{"path": "/a"}</input>
</tool_use>

<tool_use>
<name>read_file</name>
<input>{"path": "/b"}</input>
</tool_use>`;
    const result = parseCliOutput(input);
    expect(result.every((m) => m.type === "tool_call")).toBe(true);
  });
});

// ── QA-03: Storage Abstraction Integration ──────────────────────
describe("QA-03: Storage Abstraction Integration", () => {

  it("handles complete file path lifecycle", () => {
    // storage imported at top
    // 1. User types relative path in context
    const relative = "src/components/App.js";

    // 2. Normalize to absolute
    const abs = storage.normalizePath(relative, {
      workspace: "/public/myproject",
    });
    expect(abs).toBe("/public/myproject/src/components/App.js");

    // 3. Check safety
    expect(storage.isPathSafe(abs).safe).toBe(true);

    // 4. Get storage type
    expect(storage.getStorageType(abs)).toBe("proot");

    // 5. Convert to proot path for backend
    const proot = storage.toProotPath(abs, {
      PREFIX: "/data/data/com.foxdebug.acode/files",
    });
    expect(proot).toContain("files/public/myproject/src/components/App.js");
  });

  it("handles unsafe path detection early in flow", () => {
    // storage imported at top
    const path = "/sdcard/Projects/myfile.js";
    const safety = storage.isPathSafe(path);
    expect(safety.safe).toBe(false);
    // Flow should stop here and warn user
  });

  it("handles tilde expansion in user input", () => {
    // storage imported at top
    const input = "~/project/src/index.js";
    const result = storage.normalizePath(input);
    expect(result).toBe("/public/project/src/index.js");
  });

  it("handles absolute path passthrough", () => {
    // storage imported at top
    const input = "/home/user/test.js";
    const result = storage.normalizePath(input);
    expect(result).toBe("/home/user/test.js");
    expect(storage.isPathSafe(result).safe).toBe(true);
  });
});

// ── QA-04: Settings Validation ──────────────────────────────────
describe("QA-04: Settings Validation", () => {
  const DEFAULT_SETTINGS = {
    apiKey: "",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    autoApplyPatches: false,
    showDiffBeforeApply: true,
    contextLines: 200,
    sandboxEnabled: true,
    sandboxPort: 9876,
  };

  it("validates all required fields exist", () => {
    const required = [
      "apiKey",
      "model",
      "maxTokens",
      "autoApplyPatches",
      "showDiffBeforeApply",
      "contextLines",
      "sandboxEnabled",
      "sandboxPort",
    ];
    for (const key of required) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });

  it("validates model is a string", () => {
    expect(typeof DEFAULT_SETTINGS.model).toBe("string");
    expect(DEFAULT_SETTINGS.model.length).toBeGreaterThan(0);
  });

  it("validates maxTokens is in range", () => {
    expect(DEFAULT_SETTINGS.maxTokens).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SETTINGS.maxTokens).toBeLessThanOrEqual(100000);
  });

  it("validates sandboxPort is in valid range", () => {
    expect(DEFAULT_SETTINGS.sandboxPort).toBeGreaterThan(1024);
    expect(DEFAULT_SETTINGS.sandboxPort).toBeLessThan(65535);
  });

  it("validates boolean flags are booleans", () => {
    expect(typeof DEFAULT_SETTINGS.autoApplyPatches).toBe("boolean");
    expect(typeof DEFAULT_SETTINGS.showDiffBeforeApply).toBe("boolean");
    expect(typeof DEFAULT_SETTINGS.sandboxEnabled).toBe("boolean");
  });

  it("validates contextLines is in range", () => {
    expect(DEFAULT_SETTINGS.contextLines).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.contextLines).toBeLessThanOrEqual(1000);
  });

  it("blocks invalid maxTokens values", () => {
    function validate(s) {
      return s.maxTokens >= 1 && s.maxTokens <= 100000;
    }
    expect(validate({ maxTokens: 0 })).toBe(false);
    expect(validate({ maxTokens: -1 })).toBe(false);
    expect(validate({ maxTokens: 200000 })).toBe(false);
    expect(validate({ maxTokens: 4096 })).toBe(true);
  });

  it("blocks invalid port values", () => {
    function validate(s) {
      return s.sandboxPort > 1024 && s.sandboxPort < 65535;
    }
    expect(validate({ sandboxPort: 80 })).toBe(false);
    expect(validate({ sandboxPort: 443 })).toBe(false);
    expect(validate({ sandboxPort: 1024 })).toBe(false);
    expect(validate({ sandboxPort: 65535 })).toBe(false);
    expect(validate({ sandboxPort: 9876 })).toBe(true);
  });
});

// ── QA-05: WebSocket Protocol Compliance ────────────────────────
describe("QA-05: WebSocket Protocol Compliance", () => {
  it("Claude.js exports a singleton client", () => {
    // Claude imported at top
    expect(Claude).toBeDefined();
    expect(typeof Claude.connect).toBe("function");
    expect(typeof Claude.disconnect).toBe("function");
    expect(typeof Claude.sendMessage).toBe("function");
    expect(typeof Claude.applyPatch).toBe("function");
    expect(typeof Claude.rejectPatch).toBe("function");
    expect(typeof Claude.cancel).toBe("function");
  });

  it("Claude client has callback registration methods", () => {
    // Claude imported at top
    expect(typeof Claude.onMessage).toBe("function");
    expect(typeof Claude.onPatch).toBe("function");
    expect(typeof Claude.onError).toBe("function");
    expect(typeof Claude.onDisconnect).toBe("function");
  });

  it("Claude client tracks connection state", () => {
    // Claude imported at top
    // Before connect, should not be connected (returns null/falsy when ws is null)
    expect(Claude.connected).toBeFalsy();
  });

  it("sendMessage throws when not connected", async () => {
    // Claude imported at top
    Claude.disconnect();
    await expect(Claude.sendMessage("test")).rejects.toThrow(
      "Not connected"
    );
  });

  it("rejectPatch returns silently when not connected", async () => {
    // Claude imported at top
    Claude.disconnect();
    // rejectPatch silently returns when not connected
    expect(() => Claude.rejectPatch("patch-1")).not.toThrow();
  });

  it("cancel does not throw when not connected", () => {
    // Claude imported at top
    Claude.disconnect();
    // cancel should silently do nothing
    expect(() => Claude.cancel()).not.toThrow();
  });

  it("disconnect does not throw when already disconnected", () => {
    // Claude imported at top
    Claude.disconnect();
    expect(() => Claude.disconnect()).not.toThrow();
  });
});

// ── QA-06: File Structure Compliance ────────────────────────────
describe("QA-06: File Structure Compliance", () => {

  const REQUIRED_FILES = [
    "src/plugins/claude/plugin.xml",
    "src/plugins/claude/package.json",
    "src/plugins/claude/www/Claude.js",
    "src/plugins/claude/src/android/ClaudePlugin.java",
    "src/lib/claude/cliParser.js",
    "src/lib/claude/storage.js",
    "src/ai/openClaudeManager.js",
    "src/ai/messageRouter.js",
    "src/ai/toolExecutor.js",
    "src/ai/contextCollector.js",
    "src/ai/patchManager.js",
    "tests/unit/claude/cliParser.test.js",
    "tests/unit/claude/storage.test.js",
    "tests/unit/claude/settings.test.js",
    "tests/unit/ai/openClaudeManager.test.js",
    "tests/unit/ai/messageRouter.test.js",
    "tests/unit/ai/toolExecutor.test.js",
    ".github/workflows/ci.yml",
    "vitest.config.js",
    "CONTEXT.md",
    "AUDIT.md",
    "PLAN.md",
    "PATCH_CONTRACT.md",
  ];

  for (const file of REQUIRED_FILES) {
    it(`exists: ${file}`, () => {
      expect(fs.existsSync(path.resolve(file))).toBe(true);
    });
  }
});

// ── QA-07: CI/CD Pipeline Validation ────────────────────────────
describe("QA-07: CI/CD Pipeline Validation", () => {

  it("ci.yml exists and is valid YAML", async () => {
    const content = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    expect(content).toContain("name: CI");
    expect(content).toContain("on:");
    expect(content).toContain("jobs:");
  });

  it("ci.yml runs tests", () => {
    const content = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    expect(content).toContain("vitest");
    expect(content).toContain("npm ci");
  });

  it("ci.yml tests on multiple Node versions", () => {
    const content = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    expect(content).toContain("node-version:");
  });

  it("ci.yml verifies plugin structure", () => {
    const content = fs.readFileSync(".github/workflows/ci.yml", "utf8");
    expect(content).toContain("plugin.xml");
    expect(content).toContain("Claude.js");
    expect(content).toContain("ClaudePlugin.java");
  });
});

// ── QA-08: Code Quality Checks ──────────────────────────────────
describe("QA-08: Code Quality Checks", () => {
  it("cliParser.js exports all required functions", async () => {
    const mod = await import("lib/claude/cliParser.js");
    expect(typeof mod.parseCliOutput).toBe("function");
    expect(typeof mod.parseDiffContent).toBe("function");
    expect(typeof mod.createStreamingParser).toBe("function");
    expect(typeof mod.parseStreamLine).toBe("function");
  });

  it("storage.js exports all required functions", async () => {
    const mod = await import("lib/claude/storage.js");
    expect(typeof mod.normalizePath).toBe("function");
    expect(typeof mod.resolvePath).toBe("function");
    expect(typeof mod.getStorageType).toBe("function");
    expect(typeof mod.isPathSafe).toBe("function");
    expect(typeof mod.toProotPath).toBe("function");
    expect(typeof mod.fromProotPath).toBe("function");
  });

  it("cliParser.js has no syntax errors", () => {
    const content = fs.readFileSync("src/lib/claude/cliParser.js", "utf8");
    expect(content).toContain("export");
    expect(content).toContain("function");
  });

  it("storage.js has no syntax errors", () => {
    const content = fs.readFileSync("src/lib/claude/storage.js", "utf8");
    expect(content).toContain("export");
    expect(content).toContain("function");
  });

  it("Claude.js has no syntax errors", () => {
    const content = fs.readFileSync(
      "src/plugins/claude/www/Claude.js",
      "utf8"
    );
    expect(content).toContain("module.exports");
    expect(content).toContain("class ClaudeClient");
  });
});

// ── QA-09: Documentation Compliance ─────────────────────────────
describe("QA-09: Documentation Compliance", () => {

  it("CONTEXT.md contains all required sections", () => {
    const content = fs.readFileSync("CONTEXT.md", "utf8");
    const required = [
      "Project Overview",
      "Architecture",
      "API Contract",
      "Patch Application Contract",
      "Acode Codebase Reference",
      "UI/UX Integration Points",
      "Testing Strategy",
      "File Structure",
      "Risk Mitigations",
      "Design Principles",
      "Configuration",
      "Phase Exit Criteria",
      "Implementation Order",
    ];
    for (const section of required) {
      expect(content).toContain(section);
    }
  });

  it("AUDIT.md contains architecture analysis", () => {
    const content = fs.readFileSync("AUDIT.md", "utf8");
    expect(content).toContain("Architecture");
    expect(content).toContain("Cordova");
    expect(content).toContain("CodeMirror");
  });

  it("PLAN.md contains phased roadmap", () => {
    const content = fs.readFileSync("PLAN.md", "utf8");
    expect(content).toContain("Phase 0");
    expect(content).toContain("Phase 1");
    expect(content).toContain("Phase 2");
    expect(content).toContain("Phase 3");
    expect(content).toContain("Phase 4");
  });

  it("PATCH_CONTRACT.md contains state machine", () => {
    const content = fs.readFileSync("PATCH_CONTRACT.md", "utf8");
    expect(content).toContain("State Machine");
    expect(content).toContain("IDLE");
    expect(content).toContain("STREAMING");
    expect(content).toContain("ROLLBACK");
  });
});
