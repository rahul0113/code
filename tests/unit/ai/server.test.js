import { describe, it, expect } from "vitest";
import { AIServer, createServer } from "ai/server";

describe("AIServer", () => {
  it("exports createServer factory", () => {
    expect(typeof createServer).toBe("function");
  });

  it("creates server with default port", () => {
    const server = createServer();
    expect(server.port).toBe(9876);
  });

  it("creates server with custom port", () => {
    const server = createServer({ port: 1234 });
    expect(server.port).toBe(1234);
  });

  it("initializes with empty clients", () => {
    const server = createServer();
    expect(server.clients.size).toBe(0);
  });

  it("has openClaude manager", () => {
    const server = createServer();
    expect(server.openClaude).toBeDefined();
    expect(typeof server.openClaude.isRunning).toBe("function");
  });

  it("has patchManager", () => {
    const server = createServer();
    expect(server.patchManager).toBeDefined();
    expect(typeof server.patchManager.apply).toBe("function");
  });

  it("has router", () => {
    const server = createServer();
    expect(server.router).toBeDefined();
    expect(typeof server.router.handleMessage).toBe("function");
  });
});
