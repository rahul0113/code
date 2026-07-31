import { describe, it, expect } from "vitest";
import { PatchManager } from "ai/patchManager";

describe("PatchManager", () => {
  it("applies patch with null old content (new file)", () => {
    const mgr = new PatchManager();
    // Using /tmp for test safety
    const result = mgr.apply({
      filePath: "/tmp/test_patch_file.js",
      old: null,
      new: "console.log('test');",
    });
    expect(result.success).toBe(true);
    expect(result.filePath).toBe("/tmp/test_patch_file.js");
  });

  it("rejects patch with missing filePath", () => {
    const mgr = new PatchManager();
    const result = mgr.apply({ old: "", new: "content" });
    expect(result.success).toBe(false);
  });

  it("rejects patch with undefined new content", () => {
    const mgr = new PatchManager();
    const result = mgr.apply({ filePath: "/tmp/test.js", old: "", new: undefined });
    expect(result.success).toBe(false);
  });

  it("reject deletes from pending map", () => {
    const mgr = new PatchManager();
    mgr.pending.set("patch-1", { filePath: "/tmp/a.js" });
    mgr.reject("patch-1");
    expect(mgr.pending.has("patch-1")).toBe(false);
  });
});
