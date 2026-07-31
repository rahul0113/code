// tests/setup.js — Global vitest setup
// Intercepts require("cordova/exec") before any module loads
import { vi } from "vitest";
import { createRequire } from "module";
import Module from "module";

// Mock the cordova/exec module before any test imports it
vi.mock("cordova/exec", () => {
  return { default: function cordovaExec() {} };
});

// Backup original _resolveFilename
const originalResolve = Module._resolveFilename;

// Intercept resolution of cordova/exec for CJS require()
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "cordova/exec") {
    // Return the mock file path so require() can load it
    return import.meta.dirname + "/__mocks__/cordova-exec.js";
  }
  return originalResolve.call(this, request, parent, isMain, options);
};
