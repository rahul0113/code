/**
 * storage.js - Android storage abstraction layer for Claude patch operations.
 *
 * Handles the differences between:
 * - /sdcard (FUSE/virtual filesystem, no exec permissions)
 * - /storage/emulated/0 (real path of /sdcard)
 * - Internal app storage (accessible via Acode's fileSystem API)
 * - proot-mapped paths (/public/ -> $PREFIX/public/)
 *
 * Provides unified read/write/exists operations for file patches,
 * handling content:// URIs and SAF (Storage Access Framework) where needed.
 */

/**
 * Normalize a file path for use within the Claude integration.
 *
 * @param {string} path - Raw file path
 * @param {object} [context] - Workspace context
 * @param {string} [context.prefix] - proot PREFIX (e.g., /data/data/.../files)
 * @param {string} [context.workspace] - Current workspace root
 * @returns {string} Normalized absolute path
 */
function normalizePath(path, context = {}) {
  if (!path) return "";

  // Strip proot prefix if present
  let normalized = path;

  // Handle content:// URIs
  if (normalized.startsWith("content://")) {
    return normalized; // Pass through for SAF handling
  }

  // Expand ~ to /public (home in proot)
  if (normalized.startsWith("~")) {
    normalized = "/public" + normalized.slice(1);
  }

  // Handle relative paths
  if (!normalized.startsWith("/")) {
    if (context.workspace) {
      normalized = context.workspace + "/" + normalized;
    } else {
      normalized = "/public/" + normalized;
    }
  }

  // Resolve .. and .
  normalized = resolvePath(normalized);

  return normalized;
}

/**
 * Simple path resolver (no fs dependency for testability).
 * @param {string} path
 * @returns {string}
 */
function resolvePath(path) {
  const isAbsolute = path.startsWith("/");
  const hasTrailingSlash = path.length > 1 && path.endsWith("/");
  const parts = path.split("/");
  const resolved = [];

  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part === "." || part === "") {
      continue;
    } else {
      resolved.push(part);
    }
  }

  let result = resolved.join("/");
  if (isAbsolute) result = "/" + result;
  if (hasTrailingSlash && result !== "/") result += "/";
  return result || "/";
}

/**
 * Determine the storage type of a path.
 *
 * @param {string} path
 * @returns {"internal" | "external" | "sdcard" | "content" | "proot"}
 */
function getStorageType(path) {
  if (!path) return "internal";

  if (path.startsWith("content://")) return "content";
  if (path.startsWith("/sdcard")) return "sdcard";
  if (path.startsWith("/storage/")) return "external";

  // proot-mapped paths
  if (path.startsWith("/public") || path.startsWith("/home") || path.startsWith("/root")) {
    return "proot";
  }

  return "internal";
}

/**
 * Check if a path is in a safe writable location.
 * Paths under /sdcard or /storage may have permission issues.
 *
 * @param {string} path
 * @returns {{ safe: boolean, reason?: string }}
 */
function isPathSafe(path) {
  const type = getStorageType(path);

  if (type === "sdcard" || type === "external") {
    return {
      safe: false,
      reason: `Path is on external storage (${type}). ` +
        "Files may not have correct permissions for execution. " +
        "Move to /home/ or /public/ for reliable operation.",
    };
  }

  if (type === "content") {
    return {
      safe: false,
      reason: "Content URI requires SAF (Storage Access Framework) for write access.",
    };
  }

  return { safe: true };
}

/**
 * Build a proot-compatible path mapping for a given path.
 * Translates Acode workspace paths to proot-internal paths.
 *
 * @param {string} acodePath - Path as seen by Acode
 * @param {object} env - Environment variables (PREFIX, etc.)
 * @returns {string} proot-mapped path
 */
function toProotPath(acodePath, env = {}) {
  const prefix = env.PREFIX || "";

  // /public/ in proot maps to $PREFIX/public/ on the host
  if (acodePath.startsWith("/public/")) {
    return prefix + acodePath;
  }

  // /home/ in proot also maps to $PREFIX/public/ (see init-sandbox.sh)
  if (acodePath.startsWith("/home/")) {
    return prefix + "/public" + acodePath.slice(5);
  }

  // /root/ also maps to $PREFIX/public/
  if (acodePath.startsWith("/root/")) {
    return prefix + "/public" + acodePath.slice(5);
  }

  // Already an absolute host path
  if (prefix && acodePath.startsWith(prefix)) {
    return acodePath;
  }

  return acodePath;
}

/**
 * Convert a proot path back to an Acode-visible path.
 *
 * @param {string} prootPath - Path inside proot
 * @param {object} env
 * @returns {string}
 */
function fromProotPath(prootPath, env = {}) {
  const prefix = env.PREFIX || "";

  if (prefix && prootPath.startsWith(prefix + "/public/")) {
    return prootPath.slice(prefix.length);
  }

  return prootPath;
}

export {
  normalizePath,
  resolvePath,
  getStorageType,
  isPathSafe,
  toProotPath,
  fromProotPath,
};
