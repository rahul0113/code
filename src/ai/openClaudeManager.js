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
const ALLOWED_CWDS = ["/public", "/home", "/root"];

function isCwdAllowed(cwd) {
	if (!cwd) return false;
	return ALLOWED_CWDS.some((allowed) => cwd === allowed || cwd.startsWith(allowed + "/"));
}

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

    const cwd = options.cwd || "/public";
    if (!isCwdAllowed(cwd)) {
      throw new Error("Cwd not in allowlist");
    }

    this.process = spawn(CLAUDE_CMD, args, {
      env: {
        HOME: "/public",
        PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
        LANG: process.env.LANG || "en_US.UTF-8",
      },
      cwd,
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

  /**
   * Register a callback for stdout data events.
   * @param {(chunk: string) => void} callback
   */
  onStdoutData(callback) {
    if (this.process && this.process.stdout) {
      this.process.stdout.on("data", (chunk) => {
        callback(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
    }
  }

  /**
   * Write a tool result to the Claude process stdin.
   * @param {string} resultJson - The tool result as a JSON string
   * @returns {boolean} true if write succeeded
   */
  writeToolResult(resultJson) {
    if (!this.process || !this.process.stdin || !this.isRunning()) {
      return false;
    }
    try {
      this.process.stdin.write(resultJson + "\n");
      return true;
    } catch {
      return false;
    }
  }

  kill() {
    if (this.process) {
      this.process.kill("SIGTERM");
      this.process = null;
    }
  }
}

module.exports = { OpenClaudeManager };
