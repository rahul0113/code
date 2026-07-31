// tests/setup.js — Global vitest setup
// Mocks cordova/exec before any module loads
import { vi } from "vitest";

vi.mock("cordova/exec", () => ({
  default: function cordovaExec() {},
}));
