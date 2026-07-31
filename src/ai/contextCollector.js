/**
 * contextCollector.js - Gathers file context for OpenClaude prompts.
 *
 * Collects relevant files and their contents to include in prompts,
 * giving OpenClaude context about the project structure and code.
 */

const fs = require("fs");
const path = require("path");

const MAX_CONTEXT_SIZE = 50000; // ~50KB of context text
const IGNORE_DIRS = ["node_modules", ".git", "platforms", "plugins", "build", "dist", ".cache"];
const IGNORE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot", ".mp3", ".mp4"];

class ContextCollector {
  constructor(rootDir = "/public") {
    this.rootDir = rootDir;
    /** @type {{tree: string, timestamp: number}|null} */
    this._treeCache = null;
    /** @type {Map<string, {content: string, timestamp: number}>} */
    this._fileCache = new Map();
    /** @type {number} */
    this._cacheTtlMs = 60000; // 1 minute
  }

  /**
   * Collect context about a file or directory.
   * @param {string} targetPath - Path to collect context for
   * @returns {{ files: Array<{path: string, content: string, relativePath: string}>, tree: string }}
   */
  collect(targetPath) {
    const absolutePath = path.resolve(this.rootDir, targetPath);

    if (!absolutePath.startsWith(this.rootDir)) {
      return { files: [], tree: "" };
    }

    if (!fs.existsSync(absolutePath)) {
      return { files: [], tree: "" };
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isFile()) {
      return this._collectFile(absolutePath);
    }

    return this._collectDirectory(absolutePath);
  }

  _collectFile(absolutePath) {
    try {
      const content = fs.readFileSync(absolutePath, "utf8");
      const relativePath = path.relative(this.rootDir, absolutePath);
      return {
        files: [{ path: absolutePath, content, relativePath }],
        tree: relativePath,
      };
    } catch {
      return { files: [], tree: "" };
    }
  }

  _collectDirectory(absolutePath) {
    const files = [];
    const now = Date.now();

    // Use cached tree if fresh
    let tree;
    if (this._treeCache && (now - this._treeCache.timestamp) < this._cacheTtlMs) {
      tree = this._treeCache.tree;
    } else {
      tree = this._buildTree(absolutePath, 0, 2);
      this._treeCache = { tree, timestamp: now };
    }

    let totalSize = 0;

    const walk = (dir, depth = 0) => {
      if (depth > 5 || totalSize > MAX_CONTEXT_SIZE) return;

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (files.length >= 20) break;

        const fullPath = path.join(dir, entry.name);

        if (!fullPath.startsWith(this.rootDir)) continue;

        if (entry.isDirectory()) {
          if (IGNORE_DIRS.includes(entry.name)) continue;
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (IGNORE_EXTENSIONS.includes(ext)) continue;

          try {
            // Use file cache if fresh
            let content;
            const cached = this._fileCache.get(fullPath);
            if (cached && (now - cached.timestamp) < this._cacheTtlMs) {
              content = cached.content;
            } else {
              content = fs.readFileSync(fullPath, "utf8");
              this._fileCache.set(fullPath, { content, timestamp: now });
            }
            if (content.length > 10000) continue; // Skip very large files

            const relativePath = path.relative(this.rootDir, fullPath);
            files.push({ path: fullPath, content, relativePath });
            totalSize += content.length;
          } catch {
            // Skip unreadable files
          }
        }
      }
    };

    walk(absolutePath);

    return { files, tree };
  }

  _buildTree(dir, depth, maxDepth) {
    if (depth >= maxDepth) return "";

    const lines = [];
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return "";
    }

    const sorted = entries
      .filter((e) => !IGNORE_DIRS.includes(e.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    for (const entry of sorted.slice(0, 15)) {
      const indent = "  ".repeat(depth);
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`);
        const sub = this._buildTree(path.join(dir, entry.name), depth + 1, maxDepth);
        if (sub) lines.push(sub);
      } else {
        lines.push(`${indent}${entry.name}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Format collected context into a prompt-friendly string.
   * @param {{ files: Array, tree: string }} context
   * @returns {string}
   */
  formatContext(context) {
    const parts = [];

    if (context.tree) {
      parts.push("<project-structure>\n" + context.tree + "\n</project-structure>");
    }

    for (const file of context.files) {
      parts.push(`<file path="${file.relativePath}">\n${file.content}\n</file>`);
    }

    return parts.join("\n\n");
  }

  /**
   * Invalidate cached data (call after file changes).
   */
  invalidateCache() {
    this._treeCache = null;
    this._fileCache.clear();
  }
}

export { ContextCollector };
