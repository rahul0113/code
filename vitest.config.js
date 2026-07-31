import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const srcAliases = fs
  .readdirSync(srcDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({
    find: new RegExp(`^${entry.name}(?:/(.*))?$`),
    replacement: `${path.join(srcDir, entry.name)}/$1`,
  }));

export default defineConfig({
  resolve: {
    alias: [
      ...srcAliases,
      { find: "cordova/exec", replacement: path.resolve("tests/__mocks__/cordova-exec.js") },
    ],
  },
  test: {
    include: ["tests/**/*.test.{js,ts}"],
    exclude: [
      ...configDefaults.exclude,
      "src/test/**",
      "www/**",
      "platforms/**",
    ],
    setupFiles: ["./tests/setup.js"],
  },
});
