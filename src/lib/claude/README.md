# Claude Integration - Library Layer

This directory contains the backend-agnostic library code for the Claude integration.

## Files

### cliParser.js
Parses OpenClaude CLI output into structured messages for the WebSocket bridge.
- `parseCliOutput(text)` — Parse complete output into message array
- `parseDiffContent(lines)` — Parse unified diff lines into old/new content
- `createStreamingParser()` — Line-by-line streaming parser for real-time output

### storage.js
Android storage abstraction for file operations across proot, /sdcard, and internal storage.
- `normalizePath(path, context)` — Normalize and expand paths (~, relative, etc.)
- `getStorageType(path)` — Identify storage type (proot, sdcard, external, content, internal)
- `isPathSafe(path)` — Check if path is safe for write operations
- `toProotPath(path, env)` — Convert Acode path to proot-mapped path
- `fromProotPath(path, env)` — Convert proot path back to Acode-visible path

## Usage
These modules are used by the Claude backend server (running in the Alpine sandbox)
and by the Claude plugin's frontend code in Acode.
