import { describe, it, expect } from "vitest";
import { TerminalBridge } from "ai/terminalBridge";

describe("TerminalBridge", () => {
  it("creates with default state", () => {
    const bridge = new TerminalBridge();
    expect(bridge.isRunning).toBe(false);
    expect(bridge.server).toBeNull();
  });

  it("returns status when not running", () => {
    const bridge = new TerminalBridge();
    const status = bridge.getStatus();
    expect(status.running).toBe(false);
    expect(status.port).toBeNull();
    expect(status.clients).toBe(0);
  });

  it("stop does nothing when not running", async () => {
    const bridge = new TerminalBridge();
    await bridge.stop();
    expect(bridge.isRunning).toBe(false);
  });
});
