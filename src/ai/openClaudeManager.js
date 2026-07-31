/**
 * openClaudeManager.js - Manages the OpenClaude CLI child process.
 *
 * Spawns `claude` as a child process in the proot sandbox,
 * captures stdout/stderr, and streams output back to WebSocket clients.
 */

const { spawn } = require("child_process");
const { parseCliOutput } = require("../lib/claude/cliParser");

const CLAUDE_CMD = "claude";
const CLAUDE_ARGS = ["--output-format", "stream-json"];

class OpenClaudeManager {
  constructor() {
    this.process = null;
    this.outputBuffer = "";
  }

  isRunning() {
    return this.process !== null && !this.process.killed;
  }

  spawn(options = {}) {
    if (this.isRunning()) {
      this.kill();
    }

    const args = [...CLAUDE_ARGS];
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.maxTokens) {
      args.push("--max-tokens", String(options.maxTokens));
    }

    this.process = spawn(CLAUDE_CMD, args, {
      env: {
        ...process.env,
        HOME: "/public",
      },
      cwd: options.cwd || "/public",
    });

    this.outputBuffer = "";

    this.process.stdout.on("data", (data) => {
      this.outputBuffer += data.toString();
    });

    this.process.stderr.on("data", (data) => {
      console.error("[OpenClaude] stderr:", data.toString());
    });

    this.process.on("close", (code) => {
      console.log(`[OpenClaude] Process exited with code ${code}`);
      this.process = null;
    });

    this.process.on("error", (err) => {
      console.error("[OpenClaude] Spawn error:", err.message);
      this.process = null;
    });

    return this.process;
  }

  sendInput(text) {
    if (!this.isRunning()) {
      throw new Error("OpenClaude process is not running");
    }
    this.process.stdin.write(text + "\n");
  }

  getBufferedOutput() {
    const output = this.outputBuffer;
    this.outputBuffer = "";
    return output;
  }

  parseBufferedOutput() {
    const raw = this.getBufferedOutput();
    return raw ? parseCliOutput(raw) : [];
  }

  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

module.exports = { OpenClaudeManager };
