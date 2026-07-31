/**
 * settings.js - AI assistant settings management.
 *
 * Stores and retrieves user preferences for the AI assistant:
 * API key, model selection, token limits, sandbox options, and UI preferences.
 * Persists settings using Acode's internal storage.
 */

const SETTINGS_KEY = "ai_assistant_settings";

const DEFAULT_SETTINGS = {
  apiKey: "",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  autoApplyPatches: false,
  showDiffBeforeApply: true,
  contextLines: 200,
  sandboxEnabled: true,
  sandboxPort: 9876,
  // Phase 4 additions
  dailyTokenLimit: 1000000,
  monthlyTokenLimit: 20000000,
  dailyCostLimit: 10.0,
  monthlyCostLimit: 100.0,
  autoReconnect: true,
  theme: "default",
};

const VALID_MODELS = [
  "claude-sonnet-4-20250514",
  "claude-haiku",
  "claude-opus",
];

class AISettings {
  constructor() {
    /** @type {object} */
    this._settings = { ...DEFAULT_SETTINGS };
    /** @type {Set<(settings: object) => void>} */
    this._listeners = new Set();
  }

  /**
   * Load settings from storage.
   */
  load() {
    try {
      const raw = window.localStorage?.getItem(SETTINGS_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        this._settings = { ...DEFAULT_SETTINGS, ...stored };
      }
    } catch {
      // Fall back to defaults
    }
  }

  /**
   * Save current settings to storage.
   */
  save() {
    try {
      window.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(this._settings));
    } catch {
      // Storage may be full or unavailable
    }
    this._notify();
  }

  /**
   * Get all current settings.
   * @returns {object}
   */
  getAll() {
    return { ...this._settings };
  }

  /**
   * Get a single setting value.
   * @param {string} key
   * @returns {*}
   */
  get(key) {
    return this._settings[key];
  }

  /**
   * Update one or more settings.
   * @param {object} updates - Key/value pairs to update
   */
  update(updates) {
    for (const [key, value] of Object.entries(updates)) {
      if (key in DEFAULT_SETTINGS) {
        this._settings[key] = value;
      }
    }
    this.save();
  }

  /**
   * Reset all settings to defaults.
   */
  reset() {
    this._settings = { ...DEFAULT_SETTINGS };
    this.save();
  }

  /**
   * Validate the current settings.
   * @returns {{valid: boolean, errors: string[]}}
   */
  validate() {
    const errors = [];
    const s = this._settings;

    if (s.model && !VALID_MODELS.includes(s.model)) {
      errors.push(`Invalid model: ${s.model}`);
    }
    if (typeof s.maxTokens !== "number" || s.maxTokens < 1 || s.maxTokens > 100000) {
      errors.push("maxTokens must be between 1 and 100000");
    }
    if (typeof s.sandboxPort !== "number" || s.sandboxPort <= 1024 || s.sandboxPort >= 65535) {
      errors.push("sandboxPort must be between 1025 and 65534");
    }
    if (typeof s.contextLines !== "number" || s.contextLines < 1 || s.contextLines > 1000) {
      errors.push("contextLines must be between 1 and 1000");
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Register a listener for settings changes.
   * @param {(settings: object) => void} cb
   */
  onChange(cb) {
    this._listeners.add(cb);
  }

  /**
   * Remove a settings change listener.
   * @param {(settings: object) => void} cb
   */
  offChange(cb) {
    this._listeners.delete(cb);
  }

  /** @private */
  _notify() {
    const snapshot = this.getAll();
    for (const cb of this._listeners) {
      try { cb(snapshot); } catch { /* listener error */ }
    }
  }
}

const aiSettings = new AISettings();
module.exports = { aiSettings, DEFAULT_SETTINGS, VALID_MODELS };
