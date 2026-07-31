import { describe, it, expect } from "vitest";
import {
  normalizePath,
  resolvePath,
  getStorageType,
  isPathSafe,
  toProotPath,
  fromProotPath,
} from "lib/claude/storage.js";

describe("storage", () => {
  describe("normalizePath", () => {
    it("should expand ~ to /public", () => {
      expect(normalizePath("~/test.js")).toBe("/public/test.js");
      expect(normalizePath("~/.bashrc")).toBe("/public/.bashrc");
    });

    it("should handle relative paths with workspace", () => {
      const result = normalizePath("src/index.js", {
        workspace: "/public/myproject",
      });
      expect(result).toBe("/public/myproject/src/index.js");
    });

    it("should handle relative paths without workspace", () => {
      const result = normalizePath("src/index.js");
      expect(result).toBe("/public/src/index.js");
    });

    it("should leave absolute paths unchanged", () => {
      expect(normalizePath("/home/test.js")).toBe("/home/test.js");
    });

    it("should resolve .. in paths", () => {
      expect(normalizePath("/public/src/../test.js")).toBe("/public/test.js");
    });

    it("should handle content:// URIs pass-through", () => {
      const uri = "content://com.android.providers.media.documents/document/123";
      expect(normalizePath(uri)).toBe(uri);
    });

    it("should handle empty input", () => {
      expect(normalizePath("")).toBe("");
      expect(normalizePath(null)).toBe("");
    });
  });

  describe("resolvePath", () => {
    it("should resolve .. segments", () => {
      expect(resolvePath("/a/b/../c")).toBe("/a/c");
    });

    it("should resolve . segments", () => {
      expect(resolvePath("/a/./b")).toBe("/a/b");
    });

    it("should handle root path", () => {
      expect(resolvePath("/")).toBe("/");
    });

    it("should handle empty segments", () => {
      expect(resolvePath("//a///b")).toBe("/a/b");
    });
  });

  describe("getStorageType", () => {
    it("should identify sdcard paths", () => {
      expect(getStorageType("/sdcard/test.js")).toBe("sdcard");
    });

    it("should identify external storage", () => {
      expect(getStorageType("/storage/emulated/0/test.js")).toBe("external");
    });

    it("should identify proot paths", () => {
      expect(getStorageType("/public/test.js")).toBe("proot");
      expect(getStorageType("/home/test.js")).toBe("proot");
      expect(getStorageType("/root/.bashrc")).toBe("proot");
    });

    it("should identify content URIs", () => {
      expect(getStorageType("content://something")).toBe("content");
    });

    it("should default to internal", () => {
      expect(getStorageType("/data/test.js")).toBe("internal");
      expect(getStorageType("")).toBe("internal");
      expect(getStorageType(null)).toBe("internal");
    });
  });

  describe("isPathSafe", () => {
    it("should flag sdcard as unsafe", () => {
      const result = isPathSafe("/sdcard/myfile.js");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("external storage");
    });

    it("should flag content URIs as unsafe", () => {
      const result = isPathSafe("content://something");
      expect(result.safe).toBe(false);
      expect(result.reason).toContain("SAF");
    });

    it("should flag /storage as unsafe", () => {
      expect(isPathSafe("/storage/emulated/0/test").safe).toBe(false);
    });

    it("should allow /public paths", () => {
      expect(isPathSafe("/public/test.js").safe).toBe(true);
    });

    it("should allow /home paths", () => {
      expect(isPathSafe("/home/test.js").safe).toBe(true);
    });

    it("should allow internal paths", () => {
      expect(isPathSafe("/data/test.js").safe).toBe(true);
    });
  });

  describe("toProotPath", () => {
    it("should map /public/ to PREFIX/public/", () => {
      const result = toProotPath("/public/test.js", {
        PREFIX: "/data/data/com.foxdebug.acode/files",
      });
      expect(result).toBe(
        "/data/data/com.foxdebug.acode/files/public/test.js"
      );
    });

    it("should map /home/ to PREFIX/public/", () => {
      const result = toProotPath("/home/test.js", {
        PREFIX: "/data/data/com.foxdebug.acode/files",
      });
      expect(result).toBe(
        "/data/data/com.foxdebug.acode/files/public/test.js"
      );
    });

    it("should map /root/ to PREFIX/public/", () => {
      const result = toProotPath("/root/.bashrc", {
        PREFIX: "/data/data/com.foxdebug.acode/files",
      });
      expect(result).toBe(
        "/data/data/com.foxdebug.acode/files/public/.bashrc"
      );
    });

    it("should pass through paths without PREFIX", () => {
      expect(toProotPath("/data/test.js")).toBe("/data/test.js");
    });
  });

  describe("fromProotPath", () => {
    it("should map PREFIX/public/ to /public/", () => {
      const result = fromProotPath(
        "/data/data/com.foxdebug.acode/files/public/test.js",
        { PREFIX: "/data/data/com.foxdebug.acode/files" }
      );
      expect(result).toBe("/public/test.js");
    });

    it("should pass through unmatched paths", () => {
      expect(fromProotPath("/data/test.js")).toBe("/data/test.js");
    });
  });
});
