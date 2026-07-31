import { describe, it, expect } from "vitest";

/**
 * Tests for Claude settings schema.
 * These verify the default settings and validation rules
 * that will be added to src/lib/settings.js.
 */

const DEFAULT_CLAUDE_SETTINGS = {
  apiKey: "",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  autoApplyPatches: false,
  showDiffBeforeApply: true,
  contextLines: 200,
  sandboxEnabled: true,
  sandboxPort: 9876,
  theme: "auto",
  fontSize: 14,
  keybindings: {
    sendMessage: "Enter",
    cancel: "Escape",
    togglePanel: "Ctrl+Shift+A",
  },
};

describe("Claude settings defaults", () => {
  it("should have all required fields", () => {
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
      expect(DEFAULT_CLAUDE_SETTINGS).toHaveProperty(key);
    }
  });

  it("should have valid model string", () => {
    expect(typeof DEFAULT_CLAUDE_SETTINGS.model).toBe("string");
    expect(DEFAULT_CLAUDE_SETTINGS.model.length).toBeGreaterThan(0);
  });

  it("should have reasonable maxTokens", () => {
    expect(DEFAULT_CLAUDE_SETTINGS.maxTokens).toBeGreaterThan(0);
    expect(DEFAULT_CLAUDE_SETTINGS.maxTokens).toBeLessThanOrEqual(100000);
  });

  it("should have valid port range", () => {
    expect(DEFAULT_CLAUDE_SETTINGS.sandboxPort).toBeGreaterThan(1024);
    expect(DEFAULT_CLAUDE_SETTINGS.sandboxPort).toBeLessThan(65535);
  });

  it("should have contextLines within reasonable range", () => {
    expect(DEFAULT_CLAUDE_SETTINGS.contextLines).toBeGreaterThan(0);
    expect(DEFAULT_CLAUDE_SETTINGS.contextLines).toBeLessThanOrEqual(1000);
  });

  it("should have boolean flags as actual booleans", () => {
    expect(typeof DEFAULT_CLAUDE_SETTINGS.autoApplyPatches).toBe("boolean");
    expect(typeof DEFAULT_CLAUDE_SETTINGS.showDiffBeforeApply).toBe("boolean");
    expect(typeof DEFAULT_CLAUDE_SETTINGS.sandboxEnabled).toBe("boolean");
  });

  it("should have keybindings object", () => {
    expect(typeof DEFAULT_CLAUDE_SETTINGS.keybindings).toBe("object");
    expect(DEFAULT_CLAUDE_SETTINGS.keybindings).toHaveProperty("sendMessage");
    expect(DEFAULT_CLAUDE_SETTINGS.keybindings).toHaveProperty("cancel");
    expect(DEFAULT_CLAUDE_SETTINGS.keybindings).toHaveProperty("togglePanel");
  });
});

describe("Claude settings validation", () => {
  function validate(settings) {
    const errors = [];

    if (settings.maxTokens < 1 || settings.maxTokens > 100000) {
      errors.push("maxTokens must be between 1 and 100000");
    }

    if (settings.sandboxPort < 1024 || settings.sandboxPort > 65535) {
      errors.push("sandboxPort must be between 1024 and 65535");
    }

    if (settings.contextLines < 1 || settings.contextLines > 1000) {
      errors.push("contextLines must be between 1 and 1000");
    }

    if (typeof settings.autoApplyPatches !== "boolean") {
      errors.push("autoApplyPatches must be boolean");
    }

    if (typeof settings.showDiffBeforeApply !== "boolean") {
      errors.push("showDiffBeforeApply must be boolean");
    }

    return errors;
  }

  it("should accept valid defaults", () => {
    const errors = validate(DEFAULT_CLAUDE_SETTINGS);
    expect(errors).toEqual([]);
  });

  it("should reject invalid maxTokens", () => {
    const errors = validate({ ...DEFAULT_CLAUDE_SETTINGS, maxTokens: -1 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("maxTokens");
  });

  it("should reject out-of-range port", () => {
    const errors = validate({ ...DEFAULT_CLAUDE_SETTINGS, sandboxPort: 80 });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("sandboxPort");
  });

  it("should reject excessive contextLines", () => {
    const errors = validate({
      ...DEFAULT_CLAUDE_SETTINGS,
      contextLines: 5000,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]).toContain("contextLines");
  });
});
