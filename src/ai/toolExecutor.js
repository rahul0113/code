/**
 * toolExecutor.js - Executes tool calls from Claude.
 *
 * Handles: read_file, write_file, list_files, execute_command, apply_patch.
 * All file operations validate path safety and workspace boundaries.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { isPathSafe } from "../lib/claude/storage.js";

const MAX_READ_SIZE = 1048576; // 1MB
const MAX_LIST_ENTRIES = 500;
const CMD_TIMEOUT_MS = 30000;
const CMD_MAX_BUFFER = 512 * 1024;

// Blocked command patterns
const BLOCKED_PATTERNS = [
  /\b(rm\s+-rf\s+\/)/,
  /\b(mkfs)/,
  /\b(dd\s+if=)/,
  /\b(chmod\s+777)\b/,
  /\b(curl|wget|nc)\b/,
];

class ToolExecutor {
  constructor(options = {}) {
    this.workspacePath = options.workspacePath || "/workspace";
    this.patchManager = options.patchManager;
  }

  /**
   * Execute a tool call from Claude.
   * @param {{ name: string, input: object }} toolCall
   * @returns {Promise<{ output: string, error: string|null }>}
   */
  async execute(toolCall) {
    const { name, input } = toolCall;
    try {
      switch (name) {
        case "read_file":
          return this._readFile(input);
        case "write_file":
          return this._writeFile(input);
        case "list_files":
          return this._listFiles(input);
        case "execute_command":
          return this._executeCommand(input);
        case "apply_patch":
          return this._applyPatch(input);
        default:
          return { output: "", error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return { output: "", error: err.message };
    }
  }

  _isWithinWorkspace(filePath) {
    const resolved = path.resolve(filePath);
    const ws = this.workspacePath;
    return resolved === ws || resolved.startsWith(ws + "/");
  }

  _validatePath(filePath) {
    const safe = isPathSafe(filePath);
    if (!safe.safe) {
      return { valid: false, error: safe.reason };
    }
    if (!this._isWithinWorkspace(filePath)) {
      return { valid: false, error: "Path is outside the workspace" };
    }
    return { valid: true };
  }

  _readFile(input) {
    const filePath = path.resolve(input.path || "");
    const check = this._validatePath(filePath);
    if (!check.valid) return { output: "", error: check.error };

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_READ_SIZE) {
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(MAX_READ_SIZE);
        fs.readSync(fd, buf, 0, MAX_READ_SIZE, 0);
        fs.closeSync(fd);
        return { output: buf.toString("utf8") + "\n[truncated at 1MB]", error: null };
      }
      const content = fs.readFileSync(filePath, "utf8");
      return { output: content, error: null };
    } catch (err) {
      return { output: "", error: err.message };
    }
  }

  _writeFile(input) {
    const filePath = path.resolve(input.path || "");
    const content = input.content;
    if (content === undefined || content === null) {
      return { output: "", error: "No content provided" };
    }

    const check = this._validatePath(filePath);
    if (!check.valid) return { output: "", error: check.error };

    // Ensure parent directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      fs.writeFileSync(filePath, content, "utf8");
      return { output: "File written successfully", error: null };
    } catch (err) {
      return { output: "", error: err.message };
    }
  }

  _listFiles(input) {
    const dirPath = path.resolve(input.path || "");
    const check = this._validatePath(dirPath);
    if (!check.valid) return { output: "", error: check.error };

    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = [];
      const limit = Math.min(entries.length, MAX_LIST_ENTRIES);
      for (let i = 0; i < limit; i++) {
        const e = entries[i];
        lines.push(e.isDirectory() ? e.name + "/" : e.name);
      }
      if (entries.length > MAX_LIST_ENTRIES) {
        lines.push(`[showing ${MAX_LIST_ENTRIES} of ${entries.length} entries]`);
      }
      return { output: lines.join("\n"), error: null };
    } catch (err) {
      return { output: "", error: err.message };
    }
  }

  _executeCommand(input) {
    const command = input.command || "";
    if (!command) {
      return { output: "", error: "No command provided" };
    }

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(command)) {
        return { output: "", error: `Command blocked: ${command}` };
      }
    }

    try {
      const stdout = execSync(command, {
        timeout: CMD_TIMEOUT_MS,
        encoding: "utf8",
        maxBuffer: CMD_MAX_BUFFER,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { output: stdout, error: null };
    } catch (err) {
      const msg = err.stdout || err.stderr || err.message;
      return { output: "", error: msg };
    }
  }

  _applyPatch(input) {
    if (!this.patchManager) {
      return { output: "", error: "PatchManager not available" };
    }

    // Queue the patch for user approval
    const patch = this.patchManager.queue({
      filePath: input.filePath,
      old: input.old,
      new: input.new,
    });

    return {
      output: `Patch queued for approval: ${patch.id}`,
      error: null,
      pendingPatch: patch,
    };
  }
}

export { ToolExecutor };
