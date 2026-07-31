import { describe, it, expect } from "vitest";
import {
  normalizePath,
  resolvePath,
  getStorageType,
  isPathSafe,
  toProotPath,
  fromProotPath,
} from "lib/claude/storage.js";

describe("storage — Comprehensive Test Suite", () => {
  const MOCK_PREFIX = "/data/data/com.foxdebug.acode/files";

  // ── normalizePath ─────────────────────────────────────────────
  describe("normalizePath", () => {
    it("expands ~ to /public", () => {
      expect(normalizePath("~/test.js")).toBe("/public/test.js");
    });

    it("expands ~ with nested path", () => {
      expect(normalizePath("~/src/components/App.js")).toBe(
        "/public/src/components/App.js"
      );
    });

    it("expands ~ with hidden files", () => {
      expect(normalizePath("~/.bashrc")).toBe("/public/.bashrc");
      expect(normalizePath("~/.config/settings.json")).toBe(
        "/public/.config/settings.json"
      );
    });

    it("handles relative paths with workspace context", () => {
      expect(
        normalizePath("src/index.js", { workspace: "/public/myproject" })
      ).toBe("/public/myproject/src/index.js");
    });

    it("handles relative paths without workspace (defaults to /public)", () => {
      expect(normalizePath("src/index.js")).toBe("/public/src/index.js");
    });

    it("preserves absolute paths", () => {
      expect(normalizePath("/home/test.js")).toBe("/home/test.js");
      expect(normalizePath("/sdcard/Projects/app.js")).toBe(
        "/sdcard/Projects/app.js"
      );
      expect(normalizePath("/data/local/test.js")).toBe("/data/local/test.js");
    });

    it("resolves .. segments", () => {
      expect(normalizePath("/public/src/../test.js")).toBe("/public/test.js");
      expect(normalizePath("/public/a/b/../../c")).toBe("/public/c");
    });

    it("resolves . segments", () => {
      expect(normalizePath("/public/./test.js")).toBe("/public/test.js");
      expect(normalizePath("/public/src/./components/./App.js")).toBe(
        "/public/src/components/App.js"
      );
    });

    it("passes content:// URIs through unchanged", () => {
      const uri =
        "content://com.android.providers.media.documents/document/123";
      expect(normalizePath(uri)).toBe(uri);
    });

    it("returns empty string for empty input", () => {
      expect(normalizePath("")).toBe("");
    });

    it("returns empty string for null input", () => {
      expect(normalizePath(null)).toBe("");
    });

    it("returns empty string for undefined input", () => {
      expect(normalizePath(undefined)).toBe("");
    });

    it("handles paths with double slashes", () => {
      expect(normalizePath("/public//src///test.js")).toBe("/public/src/test.js");
    });

    it("handles complex workspace + relative path", () => {
      expect(
        normalizePath("../utils/helper.js", { workspace: "/public/src" })
      ).toBe("/public/utils/helper.js");
    });

    it("handles ~ with trailing slash", () => {
      expect(normalizePath("~/")).toBe("/public/");
    });
  });

  // ── resolvePath ───────────────────────────────────────────────
  describe("resolvePath", () => {
    it("resolves single .. segment", () => {
      expect(resolvePath("/a/b/../c")).toBe("/a/c");
    });

    it("resolves multiple .. segments", () => {
      expect(resolvePath("/a/b/c/../../d")).toBe("/a/d");
    });

    it("resolves . segments", () => {
      expect(resolvePath("/a/./b")).toBe("/a/b");
    });

    it("resolves mixed . and .. segments", () => {
      expect(resolvePath("/a/./b/../c")).toBe("/a/c");
    });

    it("returns / for root", () => {
      expect(resolvePath("/")).toBe("/");
    });

    it("collapses double slashes", () => {
      expect(resolvePath("//a///b")).toBe("/a/b");
    });

    it("handles single segment", () => {
      expect(resolvePath("/a")).toBe("/a");
    });

    it("handles deeply nested path", () => {
      expect(resolvePath("/a/b/c/d/e/f")).toBe("/a/b/c/d/e/f");
    });

    it("handles .. at the end", () => {
      expect(resolvePath("/a/b/..")).toBe("/a");
    });

    it("handles .. going to root", () => {
      expect(resolvePath("/a/..")).toBe("/");
    });
  });

  // ── getStorageType ────────────────────────────────────────────
  describe("getStorageType", () => {
    it("identifies /sdcard as sdcard", () => {
      expect(getStorageType("/sdcard/test.js")).toBe("sdcard");
    });

    it("identifies /storage/emulated as external", () => {
      expect(getStorageType("/storage/emulated/0/test.js")).toBe("external");
    });

    it("identifies /storage/other as external", () => {
      expect(getStorageType("/storage/ABC-123/test.js")).toBe("external");
    });

    it("identifies /public as proot", () => {
      expect(getStorageType("/public/test.js")).toBe("proot");
    });

    it("identifies /home as proot", () => {
      expect(getStorageType("/home/test.js")).toBe("proot");
    });

    it("identifies /root as proot", () => {
      expect(getStorageType("/root/.bashrc")).toBe("proot");
    });

    it("identifies content:// URIs as content", () => {
      expect(getStorageType("content://com.android/file")).toBe("content");
    });

    it("identifies /data as internal", () => {
      expect(getStorageType("/data/test.js")).toBe("internal");
    });

    it("identifies /data/user as internal", () => {
      expect(getStorageType("/data/user/0/com.foxdebug.acode/files/test.js")).toBe("internal");
    });

    it("defaults to internal for empty string", () => {
      expect(getStorageType("")).toBe("internal");
    });

    it("defaults to internal for null", () => {
      expect(getStorageType(null)).toBe("internal");
    });

    it("defaults to internal for undefined", () => {
      expect(getStorageType(undefined)).toBe("internal");
    });

    it("identifies /tmp as internal", () => {
      expect(getStorageType("/tmp/test.js")).toBe("internal");
    });

    it("identifies /var as internal", () => {
      expect(getStorageType("/var/log/test.js")).toBe("internal");
    });
  });

  // ── isPathSafe ────────────────────────────────────────────────
  describe("isPathSafe", () => {
    it("flags /sdcard as unsafe", () => {
      const result = isPathSafe("/sdcard/myfile.js");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("external storage");
    });

    it("flags /storage as unsafe", () => {
      const result = isPathSafe("/storage/emulated/0/test.js");
      expect(result.safe).toBe(false);
    });

    it("flags content:// URIs as unsafe", () => {
      const result = isPathSafe("content://something");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("SAF");
    });

    it("allows /public paths", () => {
      expect(isPathSafe("/public/test.js").safe).toBe(true);
    });

    it("allows /home paths", () => {
      expect(isPathSafe("/home/test.js").safe).toBe(true);
    });

    it("allows /root paths", () => {
      expect(isPathSafe("/root/.bashrc").safe).toBe(true);
    });

    it("allows internal /data paths", () => {
      expect(isPathSafe("/data/test.js").safe).toBe(true);
    });

    it("allows /tmp paths", () => {
      expect(isPathSafe("/tmp/test.js").safe).toBe(true);
    });

    it("returns safe for empty string (internal default)", () => {
      expect(isPathSafe("").safe).toBe(true);
    });

    it("returns safe for null (internal default)", () => {
      expect(isPathSafe(null).safe).toBe(true);
    });
  });

  // ── toProotPath ───────────────────────────────────────────────
  describe("toProotPath", () => {
    it("maps /public/ to PREFIX/public/", () => {
      expect(toProotPath("/public/test.js", { PREFIX: MOCK_PREFIX })).toBe(
        `${MOCK_PREFIX}/public/test.js`
      );
    });

    it("maps /home/ to PREFIX/public/", () => {
      expect(toProotPath("/home/test.js", { PREFIX: MOCK_PREFIX })).toBe(
        `${MOCK_PREFIX}/public/test.js`
      );
    });

    it("maps /root/ to PREFIX/public/", () => {
      expect(toProotPath("/root/.bashrc", { PREFIX: MOCK_PREFIX })).toBe(
        `${MOCK_PREFIX}/public/.bashrc`
      );
    });

    it("maps nested /public/ paths correctly", () => {
      expect(
        toProotPath("/public/src/components/App.js", { PREFIX: MOCK_PREFIX })
      ).toBe(`${MOCK_PREFIX}/public/src/components/App.js`);
    });

    it("maps nested /home/ paths correctly", () => {
      expect(
        toProotPath("/home/project/src/index.js", { PREFIX: MOCK_PREFIX })
      ).toBe(`${MOCK_PREFIX}/public/project/src/index.js`);
    });

    it("passes through paths without PREFIX match", () => {
      expect(toProotPath("/data/test.js")).toBe("/data/test.js");
    });

    it("passes through paths when PREFIX is empty", () => {
      expect(toProotPath("/public/test.js", { PREFIX: "" })).toBe(
        "/public/test.js"
      );
    });

    it("passes through /sdcard paths unchanged", () => {
      expect(toProotPath("/sdcard/test.js", { PREFIX: MOCK_PREFIX })).toBe(
        "/sdcard/test.js"
      );
    });

    it("passes through /tmp paths unchanged", () => {
      expect(toProotPath("/tmp/test.js", { PREFIX: MOCK_PREFIX })).toBe(
        "/tmp/test.js"
      );
    });
  });

  // ── fromProotPath ─────────────────────────────────────────────
  describe("fromProotPath", () => {
    it("maps PREFIX/public/ to /public/", () => {
      expect(
        fromProotPath(`${MOCK_PREFIX}/public/test.js`, { PREFIX: MOCK_PREFIX })
      ).toBe("/public/test.js");
    });

    it("maps PREFIX/public/ nested paths correctly", () => {
      expect(
        fromProotPath(
          `${MOCK_PREFIX}/public/src/components/App.js`,
          { PREFIX: MOCK_PREFIX }
        )
      ).toBe("/public/src/components/App.js");
    });

    it("passes through unmatched paths", () => {
      expect(fromProotPath("/data/test.js", { PREFIX: MOCK_PREFIX })).toBe(
        "/data/test.js"
      );
    });

    it("passes through paths when PREFIX is empty", () => {
      expect(fromProotPath("/public/test.js", { PREFIX: "" })).toBe(
        "/public/test.js"
      );
    });

    it("handles /home mapped path (already mapped to /public in proot)", () => {
      // After proot mapping, /home is /public, so fromProotPath should handle PREFIX/public
      expect(
        fromProotPath(`${MOCK_PREFIX}/public/.bashrc`, { PREFIX: MOCK_PREFIX })
      ).toBe("/public/.bashrc");
    });
  });

  // ── Roundtrip tests ───────────────────────────────────────────
  describe("roundtrip: toProotPath + fromProotPath", () => {
    it("roundtrips /public/ paths", () => {
      const original = "/public/src/index.js";
      const proot = toProotPath(original, { PREFIX: MOCK_PREFIX });
      const back = fromProotPath(proot, { PREFIX: MOCK_PREFIX });
      expect(back).toBe(original);
    });

    it("roundtrips /home/ paths (mapped to /public)", () => {
      const original = "/home/src/index.js";
      const expected = "/public/src/index.js";
      const proot = toProotPath(original, { PREFIX: MOCK_PREFIX });
      const back = fromProotPath(proot, { PREFIX: MOCK_PREFIX });
      expect(back).toBe(expected);
    });

    it("roundtrips /root/ paths (mapped to /public)", () => {
      const original = "/root/.bashrc";
      const expected = "/public/.bashrc";
      const proot = toProotPath(original, { PREFIX: MOCK_PREFIX });
      const back = fromProotPath(proot, { PREFIX: MOCK_PREFIX });
      expect(back).toBe(expected);
    });
  });

  // ── Integration scenarios ─────────────────────────────────────
  describe("integration scenarios", () => {
    it("normalizes a relative path then checks safety", () => {
      const path = normalizePath("src/index.js", { workspace: "/public/project" });
      expect(getStorageType(path)).toBe("proot");
      expect(isPathSafe(path).safe).toBe(true);
    });

    it("normalizes a ~ path then converts to proot", () => {
      const normalized = normalizePath("~/project/app.js");
      const proot = toProotPath(normalized, { PREFIX: MOCK_PREFIX });
      expect(proot).toBe(`${MOCK_PREFIX}/public/project/app.js`);
    });

    it("identifies unsafe paths early", () => {
      const path = "/sdcard/Projects/myfile.js";
      expect(isPathSafe(path).safe).toBe(false);
      // Don't bother converting if unsafe
    });

    it("handles a realistic file creation flow", () => {
      // User creates file in terminal at /public/myproject/new.js
      const terminalPath = "/public/myproject/new.js";
      const storageType = getStorageType(terminalPath);
      expect(storageType).toBe("proot");

      const safety = isPathSafe(terminalPath);
      expect(safety.safe).toBe(true);

      const proot = toProotPath(terminalPath, { PREFIX: MOCK_PREFIX });
      expect(proot).toBe(`${MOCK_PREFIX}/public/myproject/new.js`);
    });

    it("handles a realistic sdcard project flow", () => {
      const path = "/sdcard/Projects/app/src/index.js";
      expect(getStorageType(path)).toBe("sdcard");
      expect(isPathSafe(path).safe).toBe(false);
      // AI should warn user to move project to /home
    });
  });
});
