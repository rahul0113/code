import { describe, it, expect } from "vitest";
import { PatchManager } from "ai/patchManager";

describe("PatchManager", () => {
  it("applies patch with null old content (new file)", () => {
    const mgr = new PatchManager();
    // Use process.cwd() so the path exists in both local and CI environments
    const testPath = require("path").join(process.cwd(), ".test_patch_file.js");
    try {
      const result = mgr.apply({
        filePath: testPath,
        old: null,
        new: "console.log('test');",
      });
      expect(result.success).toBe(true);
      expect(result.filePath).toBe(testPath);
    } finally {
      try { require("fs").unlinkSync(testPath); } catch {}
    }
  });

  it("rejects patch with missing filePath", () => {
    const mgr = new PatchManager();
    const result = mgr.apply({ old: "", new: "content" });
    expect(result.success).toBe(false);
  });

  it("rejects patch with undefined new content", () => {
    const mgr = new PatchManager();
    const result = mgr.apply({ filePath: "/public/test.js", old: "", new: undefined });
    expect(result.success).toBe(false);
  });

  it("reject deletes from pending map", () => {
    const mgr = new PatchManager();
    mgr.pending.set("patch-1", { filePath: "/public/a.js" });
    mgr.reject("patch-1");
    expect(mgr.pending.has("patch-1")).toBe(false);
  });
});
