# Acode + OpenClaude Integration — Complete Context Document

> Single-source reference for all technical context, architecture decisions, API contracts, testing strategies, and implementation patterns. Read this file before starting any development session.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [API Contract](#3-api-contract)
4. [Patch Application Contract](#4-patch-application-contract)
5. [Acode Codebase Reference](#5-acode-codebase-reference)
6. [UI/UX Integration Points](#6-uiux-integration-points)
7. [Testing Strategy](#7-testing-strategy)
8. [File Structure](#8-file-structure)
9. [Risk Mitigations](#9-risk-mitigations)
10. [Design Principles](#10-design-principles)
11. [Configuration](#11-configuration)
12. [Phase Exit Criteria](#12-phase-exit-criteria)
13. [Implementation Order](#13-implementation-order)
14. [Key Files Quick Reference](#14-key-files-quick-reference)

---

## 1. Project Overview

**Goal:** Build a personal "vibe coding" tool by integrating OpenClaude (AI coding agent CLI) into Acode (Android code editor), with proper file synchronization between terminal and file browser. Personal-use only, not commercial.

**Status:** Feasible. Forking Acode saves 6-12 months of editor work. Main work is building AI integration layer and fixing file sync.

**Platform:** Android (minSdk 26, targetSdk 36), Apache Cordova 13.0.0, CodeMirror 6, Rspack build system.

**License:** MIT (with LGPL risk from bundled FTP/SFTP plugins — must remove).

---

## 2. Architecture

### Backend: Node.js WebSocket Bridge

```
┌─────────────────────────────────────────────┐
│  Acode WebView (Frontend)                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ AI Panel │  │ Diff View│  │ Patch UI  │  │
│  │ (sidebar)│  │ (CM6)    │  │ (dialog)  │  │
│  └────┬─────┘  └────┬─────┘  └────┬──────┘  │
│       └──────────────┼─────────────┘         │
│                      │ WebSocket             │
├──────────────────────┼───────────────────────┤
│  Node.js Backend (in proot/Alpine)           │
│  ┌───────────────────┴────────────────────┐  │
│  │        WebSocket Server (:9876)        │  │
│  └───────────────────┬────────────────────┘  │
│  ┌───────────┐  ┌────┴─────┐  ┌───────────┐ │
│  │ OpenClaude│  │ Context  │  │ Patch     │ │
│  │ (child)   │  │Collector │  │ Manager   │ │
│  └───────────┘  └──────────┘  └───────────┘ │
└─────────────────────────────────────────────┘
         ↕ proot bind mounts
┌─────────────────────────────────────────────┐
│  Filesystem (shared via /public mount)       │
│  /data/user/0/.../files/public/ ↔ /public   │
└─────────────────────────────────────────────┘
```

**Why this architecture:**
- OpenClaude is Node.js CLI — child process avoids rewriting in Java/Kotlin
- WebSocket gives real-time bidirectional communication
- Acode already has `cordova-plugin-websocket` and xterm.js with WebSocket backend
- Node.js runs natively on Android via proot/Alpine sandbox
- No need for Android service binding, JNI, or native bridges

**Key decisions:**
- Backend runs as Node.js process started from terminal init script
- WebSocket server on `localhost:9876` (loopback only)
- Frontend connects via existing WebSocket API
- OpenClaude runs as child process of WebSocket server
- Context collection reads files via Node.js `fs` module

---

## 3. API Contract

### WebSocket Protocol (JSON Messages)

**Client → Server (Acode → Backend):**

```json
// Send chat message
{
  "id": "uuid-1",
  "type": "chat.send",
  "payload": {
    "message": "Fix the bug in main.js line 42",
    "context": {
      "activeFile": "src/main.js",
      "openFiles": ["src/main.js", "src/utils.js"],
      "selection": "line 42: const x = null;",
      "cwd": "/public/myproject"
    }
  }
}

// Request patch application
{
  "id": "uuid-2",
  "type": "patch.apply",
  "payload": {
    "patchId": "patch-abc-123",
    "action": "accept" | "reject" | "modify"
  }
}

// Cancel ongoing request
{
  "id": "uuid-4",
  "type": "chat.cancel",
  "payload": {}
}

// Health ping
{
  "type": "server.ping"
}
```

**Server → Client (Backend → Acode):**

```json
// Streaming response chunks
{
  "id": "uuid-1",
  "type": "chat.chunk",
  "payload": {
    "content": "I found the issue...",
    "done": false
  }
}

// Complete response
{
  "id": "uuid-1",
  "type": "chat.done",
  "payload": {
    "messageId": "msg-xyz",
    "usage": { "inputTokens": 1200, "outputTokens": 800 }
  }
}

// Patch ready for review
{
  "type": "patch.ready",
  "payload": {
    "patchId": "patch-abc-123",
    "description": "Fixed null check in main.js",
    "files": [{
      "path": "src/main.js",
      "diff": "--- a/src/main.js\n+++ b/src/main.js\n...",
      "linesAdded": 1,
      "linesRemoved": 1
    }]
  }
}

// Patch result
{
  "type": "patch.result",
  "payload": {
    "patchId": "patch-abc-123",
    "success": true,
    "message": "Patch applied successfully"
  }
}

// Error
{
  "type": "error",
  "payload": {
    "code": "NETWORK_ERROR" | "API_ERROR" | "PATCH_CONFLICT" | "TOKEN_LIMIT",
    "message": "Connection lost. Retrying in 3s..."
  }
}

// Server status
{
  "type": "server.status",
  "payload": {
    "state": "ready" | "processing" | "error",
    "uptime": 3600
  }
}
```

### File Sync Protocol

```json
// File changed notification (server → client)
{
  "type": "fs.changed",
  "payload": {
    "path": "src/main.js",
    "event": "create" | "modify" | "delete",
    "timestamp": 1722412800000
  }
}
```

### Error Codes

| Code | Meaning | Frontend Action |
|------|---------|-----------------|
| `NETWORK_ERROR` | WebSocket disconnected | Auto-reconnect with backoff, show toast |
| `API_ERROR` | Claude API returned error | Show error in chat, don't retry |
| `PATCH_CONFLICT` | Patch conflicts with local changes | Show conflict dialog, offer merge |
| `TOKEN_LIMIT` | Context too large for model | Auto-truncate, warn user |
| `TIMEOUT` | Request timed out (>60s) | Offer cancel/retry |
| `PROCESS_CRASH` | Backend Node process died | Restart backend, restore state |

---

## 4. Patch Application Contract

### State Machine: Prompt to Apply

```
IDLE → SENDING → STREAMING → PATCH_READY → ACCEPTED → PRE_SNAP → APPLYING → APPLIED → REFRESHING → IDLE
                 ↓              ↓              ↓           ↓
              RETRY_QUEUE    REJECTED        CANCEL      FAILED → ROLLBACK → IDLE
```

### Pre-conditions (Check Before Any Patch)

1. Is the target file still open in the editor?
   - YES → check buffer state
   - NO → check disk state
2. Has the file been modified on disk since the request started?
   - YES → BLOCK patch, notify user
   - NO → continue
3. Is the editor buffer dirty (unsaved changes)?
   - YES → BLOCK patch, notify user to save first
   - NO → continue
4. Does the patch target lines that exist in the current buffer?
   - YES → continue
   - NO → BLOCK patch, notify user

### Patch Types

| Type | Detection | Action |
|------|-----------|--------|
| Modify | Path exists, patch has -/+ lines | Backup → apply diff → write |
| Create | Path doesn't exist, patch is all + lines | Backup parent dir → create file → write |
| Delete | Path exists, patch removes entire content | Backup file → delete |
| Rename | v1: BLOCK | Notify "Rename patches not supported in v1" |

### Application Sequence

1. **VALIDATE** — Parse unified diff, check paths exist/don't exist, check line numbers match
2. **SNAPSHOT** — Read current file from EDITOR BUFFER (not disk), store in PatchHistory
3. **apply** — Apply diff to current buffer content, write via Acode's fsOperation()
4. **VERIFY** — Read back written file, compare with expected result, ROLLBACK if mismatch
5. **REFRESH** — Reload editor buffer (editor.setValue), clear fileBrowser cache, emit "file-content-changed"

### Partial Patch Failure

v1: No partial application. If any file fails → STOP → ROLLBACK all applied files (reverse order) → notify user.

### Rollback Strategy

- Pre-patch snapshot stored in PatchHistory (max 20 FIFO)
- Rollback: write originalContent back via Acode FS, reload editor buffer, refresh file tree
- Crash recovery: check state.json on backend restart, rollback incomplete patches

### Conflict Detection Matrix

| Editor Buffer | Disk State | Patch Expects | Action |
|---------------|------------|---------------|--------|
| Clean, matches disk | Unchanged | Matches disk | APPLY |
| Clean, matches disk | Changed | Matches disk | BLOCK: "File changed on disk" |
| Dirty (unsaved) | Unchanged | Any | BLOCK: "Save first" |
| Clean, differs disk | Any | Any | Use buffer as source, APPLY |
| File not open | Exists | Matches disk | APPLY |
| File not open | Exists | Changed | BLOCK: "File changed" |
| File not open | Doesn't exist | Is create | APPLY |
| File not open | Doesn't exist | Is modify | BLOCK: "File not found" |

---

## 5. Acode Codebase Reference

### Core Directory Structure

```
src/
├── cm/              # CodeMirror 6 integration (30+ files)
│   ├── lsp/         # Language Server Protocol client
│   ├── modes/       # Language mode definitions
│   └── themes/      # Editor themes
├── components/      # UI components including terminal
├── dialogs/         # Dialog windows (prompt, alert, select, etc.)
├── fileSystem/      # File system abstraction layer
│   ├── index.js     # Factory routing to internal/external FS
│   ├── internalFs.js # Cordova filesystem APIs
│   ├── externalFs.js # Storage Access Framework (SAF)
├── handlers/        # Event/operation handlers
├── lang/            # 20+ i18n language files
├── lib/             # Core modules
│   ├── acode.js     # Plugin API (Acode class)
│   ├── settings.js  # App settings
│   ├── loadPlugins.js # Plugin loader
│   ├── openFolder.js # Folder tree manager
│   ├── editorFile.js # Editor tab management
│   └── eventMap.js  # Event constants
├── pages/           # App pages/views
│   └── fileBrowser/ # File browser page
├── plugins/         # Bundled Cordova native plugins (18 total)
├── settings/        # Settings UI pages (14 files)
├── sidebarApps/     # Sidebar applications
├── styles/          # SCSS stylesheets
├── theme/           # App theme system
├── utils/           # Utility modules
└── views/           # View definitions
```

### Plugin System

- **Loading:** Filesystem-based, loaded from device storage at runtime
- **API:** `Acode` class (`src/lib/acode.js`) exposes modules to plugins
- **Timeouts:** 15s per plugin, 60s before broken plugin retry
- **Tracking:** `BROKEN_PLUGINS` Map, `LOADED_PLUGINS` Set

### Terminal

- **Frontend:** xterm.js 6.0.0 with 7 addons
- **Backend:** Native Android `TerminalService` (Java) with WebSocket server
- **Shell:** proot-based Alpine Linux sandbox
- **Default WebSocket port:** 8767
- **Features:** Multiple concurrent processes, foreground service, wake lock

### File System

- **Internal storage:** Cordova `window.resolveLocalFileSystemURL()`
- **External storage:** Storage Access Framework (SAF)
- **Unified API:** `fsOperation()` factory routes to appropriate implementation

### The File Sync Problem

**Root cause:** Acode's file browser has no automatic filesystem refresh. It caches directory listings in memory and never reconciles with the actual filesystem.

**Proot mount points (init-sandbox.sh):**
```bash
ARGS="$ARGS -b $PREFIX/public:/public"    # App private storage
ARGS="$ARGS -b $PREFIX/public:/home"      # App private storage
ARGS="$ARGS -b $PREFIX/public:/root"      # App private storage
ARGS="$ARGS -b /sdcard"                    # External storage
```

**Terminal environment (init-alpine.sh):**
```bash
export HOME=/public    # ← This is the problem
```

**Fix sequence:**
1. Add `refresh()` to openFolder.js
2. Call on app resume in main.js
3. Clear fileBrowser cache on show
4. Terminal hook: emit 'fs-changed' on command completion

---

## 6. UI/UX Integration Points

### AI Chat Panel (Sidebar Tab)

```javascript
import sidebarApps from "src/sidebarApps";

sidebarApps.add(
  "robot",           // icon CSS class
  "ai-chat",         // unique ID
  "AI Chat",         // tooltip
  (container) => {   // init function
    // Build chat UI into container
    return () => { /* cleanup */ };
  },
  false,             // prepend
  (container) => {   // onSelected callback
    // Focus input, scroll to bottom
  }
);
```

### AI Chat as Editor Tab (Alternative)

```javascript
const chatFile = new EditorFile("AI Chat", {
  type: "page",
  content: chatContent,
  tabIcon: "robot",
});
```

### Diff Viewer

```javascript
import { MergeView } from "@codemirror/merge";
const mergeView = new MergeView({
  parent: diffContainer,
  original: originalContent,
  modified: patchedContent,
});
```

### Patch Approval Dialog

```javascript
const confirm = acode.require("confirm");
const result = await confirm("Apply Patch", "Apply changes to src/main.js?");
if (result) { /* apply patch */ }
```

### Event System

```javascript
editorManager.on("switch-file", (file) => { /* update AI context */ });
editorManager.on("file-content-changed", (file) => { /* track unsaved changes */ });
editorManager.on("new-file", (file) => { /* add to open files list */ });
```

### Notifications

```javascript
import toast from "src/components/toast";
toast("Patch applied successfully", "success");
toast("AI request failed", "error");
toast("Reconnecting to backend...", "warning");
```

### Theming (CSS Variables)

```css
.ai-chat-panel { background: var(--secondary-color); color: var(--secondary-text-color); }
.ai-message-user { background: var(--active-color); }
.ai-message-ai { background: var(--primary-color); }
.ai-error { color: var(--error-text-color); }
.ai-success { color: var(--success-text-color); }
```

### Key Bindings

Available Ctrl+ shortcuts: Ctrl+G, Ctrl+D, Ctrl+L, Ctrl+E, Ctrl+M, Ctrl+B, Ctrl+N, Ctrl+K, Ctrl+I, Ctrl+U, Ctrl+Y, Ctrl+X, Ctrl+Q, Ctrl+R

Recommended:
| Shortcut | Action |
|----------|--------|
| Ctrl+G | Toggle AI chat panel |
| Ctrl+E | Send selected code to AI |
| Ctrl+L | Clear AI chat |

---

## 7. Testing Strategy

### Current State

| Category | Status |
|----------|--------|
| Test framework | Vitest 4.1.10 configured |
| Unit tests | 11 files in `tests/unit/` |
| CI test execution | MISSING — no `npm test` in CI |
| Coverage | MISSING |
| Mocks | MISSING |
| Fixtures | MISSING |

### Testing Layers

**Layer 1: Unit Tests (Vitest)** — Run in CI, mock-heavy, < 30s, 80%+ coverage target
**Layer 2: Integration Tests** — WebSocket server ↔ client, patch flow with temp files
**Layer 3: In-App Tests** — Extend existing `src/test/tester.js`, test on real device
**Layer 4: Manual Testing** — Full flow checklist on physical Android device

### Mock Strategy

```javascript
// tests/__mocks__/editorManager.js
export default {
  editor: { getValue: () => "mock content", dispatch: vi.fn() },
  on: vi.fn(),
  getFile: vi.fn(),
  getFiles: () => [],
};
```

### Context Policy

**Always included:** User message, active file path, working directory, project type, open file names
**On demand:** Active file content, selected text, other open file content, file tree (top 2 levels)
**Never:** API key, .env files, node_modules, build output, binary files, files > 100KB, git history

**Hard limits:** Max 5 files with content, 8,000 tokens total, 4,000 tokens per file, 2,000 tokens selected text

---

## 8. File Structure (New AI Layer)

```
src/
├── ai/                          # New AI integration layer
│   ├── server.js                # WebSocket server
│   ├── openClaudeManager.js     # Child process management
│   ├── messageRouter.js         # Message routing
│   ├── contextCollector.js      # Gather context for AI
│   ├── patchManager.js          # Parse/apply patches
│   ├── diffViewer.js            # Diff rendering
│   ├── patchDialog.js           # Patch review UI
│   ├── conflictResolver.js      # Conflict handling
│   ├── patchHistory.js          # Undo support
│   ├── tokenManager.js          # Token tracking
│   ├── settings.js              # AI settings
│   ├── conversationStore.js     # Chat persistence
│   └── websocket.js             # Client-side WS connection
├── lib/claude/                  # Library layer
│   ├── cliParser.js             # OpenClaude CLI output parser
│   ├── storage.js               # Android storage abstraction
│   └── README.md
├── plugins/claude/              # Cordova plugin
│   ├── plugin.xml
│   ├── package.json
│   ├── www/Claude.js            # JS bridge
│   └── src/android/ClaudePlugin.java
├── sidebarApps/ai/              # AI chat sidebar
│   ├── index.js
│   ├── chat.js
│   └── status.js
├── styles/ai.scss               # AI-specific styles
tests/
├── __mocks__/
├── fixtures/
│   ├── patches/
│   ├── ai-responses/
│   └── files/
├── unit/claude/
│   ├── cliParser.test.js
│   ├── storage.test.js
│   └── settings.test.js
└── integration/ai.test.js
```

---

## 9. Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Android kills background Node process | Restart on WebSocket reconnect, persist state to disk |
| Token limit exceeded mid-conversation | Auto-truncate old messages, warn user |
| Patch conflicts with unsaved editor | Check dirty state, prompt save before apply |
| Network drops during AI request | Queue request, retry with exponential backoff |
| OpenClaude process crashes | Restart child process, offer "reset conversation" |
| Large repo context explosion | Limit to open files + selection, not full project |
| musl/glibc mismatch in proot | Test critical npm packages against musl early |
| Prompt injection via file contents | Sanitize context, never execute AI-generated shell commands |
| SAF performance with large projects | Never use SAF for AI indexing, mirror metadata locally |
| Token explosion with 1500+ files | BM25 + embeddings + dependency graph for relevance ranking |
| Android memory pressure (6GB devices) | Lazy-load AI components, limit conversation history, LRU cache |
| Race conditions (AI + terminal) | Centralized filesystem event queue, sequential processing |
| Multiple rapid AI requests | Request queue with sequential processing, cancel button, request IDs |
| Crash recovery (AI edits 42 files → crash) | Persist conversation history, pending patches, unapplied edits to disk |
| Mobile network instability | Request IDs, timeout with retry, offline queue, progress indicators |

---

## 10. Design Principles

1. **Editor is authority** — AI suggests, editor applies
2. **Patches, not writes** — All AI changes go through reviewable diffs
3. **Hash everything** — Detect conflicts between editor buffer, disk, and AI
4. **Event queue** — Centralized filesystem events, not random refreshes
5. **Assume disconnected** — Reconnect, resume, resync
6. **Local index** — Never use SAF for AI operations
7. **Context budget** — Rank relevance, cap tokens
8. **Git safety net** — Auto-checkpoint before AI operations
9. **Trust boundaries** — Separate system/user/untrusted content
10. **Incremental everything** — Indexing, watching, updating

---

## 11. Configuration

### Key Values

| Setting | Value |
|---------|-------|
| App ID | `com.foxdebug.acode` |
| Min SDK | 26 (Android 8.0) |
| Target SDK | 36 |
| Terminal WS Port | 8767 |
| AI Backend WS Port | 9876 |
| Plugin Load Timeout | 15 seconds |
| Bundled Plugins | 18 |
| LSP Servers | JS, TS, Python, HTML, CSS, JSON, Systems, Luau |

### AI Settings (Default)

```javascript
{
  apiKey: "",
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
  autoApplyPatches: false,
  showDiffBeforeApply: true,
  contextLines: 200,
  sandboxEnabled: true,
  sandboxPort: 9876,
  keybindings: {
    sendMessage: "Enter",
    cancel: "Escape",
    togglePanel: "Ctrl+Shift+A",
  },
}
```

### Backend Startup Sequence

1. init-alpine.sh runs
2. Check if Node.js installed: `command -v node`
3. Check if backend server exists: `$PREFIX/ai-backend/server.js`
4. Start backend: `node $PREFIX/ai-backend/server.js &`
5. Wait up to 3s for WebSocket port: `nc -z localhost 9876`
6. Frontend connects on next WebView load

### Health Ping

Frontend sends `{ type: "server.ping" }` every 30s. Backend responds `{ type: "server.pong" }`. If no pong in 5s → mark disconnected → auto-reconnect loop.

### Reconnect Logic

Exponential backoff: 1s → 2s → 4s → 8s → 16s → 30s (cap). Max 10 attempts. Then disable AI features until manual reconnect.

---

## 12. Phase Exit Criteria

### Phase 0: Foundation
- [ ] npm test passes in CI
- [ ] File sync works: create file in terminal → appears in file browser
- [ ] No license risks (FTP/SFTP removed, fonts have licenses)

### Phase 1: Backend Core
- [ ] WebSocket connects and stays connected for 10 minutes
- [ ] Backend survives 5 rapid connect/disconnect cycles
- [ ] OpenClaude child process starts, responds to ping, can be restarted
- [ ] State recovery: kill backend → restart → pending patch rolled back

### Phase 2: Frontend Chat
- [ ] Send message → receive full streaming response → render in chat
- [ ] Backend disconnect → toast shown → auto-reconnect within 30s
- [ ] Ctrl+G toggles chat panel open/closed
- [ ] AI panel does not break when switching between files

### Phase 3: Patch Flow
- [ ] Patch apply survives unsaved buffer conflict (blocked with message)
- [ ] Patch apply survives file-rename-during-request (blocked with message)
- [ ] Patch apply with 2-file patch, second file fails → both rolled back
- [ ] Undo reverts last AI change completely
- [ ] App resumes after backend kill without losing pending patch

### Phase 4: Polish
- [ ] API key stored in config.json, never logged
- [ ] Context never exceeds 8,000 tokens
- [ ] 20+ unit tests for AI modules passing
- [ ] Full flow test: prompt → stream → patch → apply → undo → done

---

## 13. Implementation Order

Build in this exact sequence. Each step must pass its gate before moving on.

```
1.  WebSocket server (server.js) + health ping
2.  Frontend WebSocket client (websocket.js)
3.  Chat UI (sidebar app, message rendering)
4.  OpenClaude manager (spawn, pipe, restart)
5.  Context collector (open files, selection)
6.  Patch manager (parse diff, validate)
7.  Pre-patch snapshot + PatchHistory
8.  Patch apply via Acode FS
9.  Editor buffer reload after apply
10. File tree refresh after apply
11. Rollback mechanism
12. Conflict detection (all 8 matrix cases)
13. Config file for API key
14. Unit tests for each module
15. Integration test for full flow
```

Stop after step 15. That is v1.

---

## 14. Key Files Quick Reference

| File | Purpose |
|------|---------|
| `src/lib/acode.js` | Plugin API — `Acode` class exposes modules to plugins |
| `src/lib/settings.js` | App settings — add `claude` section here |
| `src/lib/openFolder.js` | Folder tree manager — add `refresh()` method |
| `src/lib/editorFile.js` | Editor tab management — `EditorFile` class with Shadow DOM |
| `src/lib/editorManager.js` | Editor events: `switch-file`, `file-content-changed`, `new-file` |
| `src/lib/eventMap.js` | Event constants |
| `src/lib/keyBindings.js` | Key binding registration |
| `src/components/toast/index.js` | Toast notifications |
| `src/dialogs/dialog.js` | Dialog base class |
| `src/fileSystem/index.js` | `fsOperation()` factory |
| `src/fileSystem/internalFs.js` | Internal storage read/write |
| `src/pages/fileBrowser/fileBrowser.js` | File browser UI with `cachedDir` |
| `src/sidebarApps/` | Sidebar app registration |
| `src/plugins/terminal/scripts/init-sandbox.sh` | proot mount points, PROOT config |
| `src/plugins/terminal/scripts/init-alpine.sh` | Alpine Linux setup, HOME=/public |
| `src/plugins/terminal/www/Terminal.js` | xterm.js terminal frontend |
| `src/plugins/terminal/www/Executor.js` | Process execution: start(), write(), kill() |
| `src/plugins/websocket/` | WebSocket Cordova plugin |
| `src/main.js` | App entry, `resumeHandler()` |
| `tests/unit/claude/cliParser.test.js` | CLI parser tests |
| `tests/unit/claude/storage.test.js` | Storage abstraction tests |
| `tests/unit/claude/settings.test.js` | Settings validation tests |
| `vitest.config.js` | Test configuration |
| `.github/workflows/ci.yml` | CI/CD pipeline |

---

## Dependencies to Install

```bash
# Diff viewer
npm install @codemirror/merge

# Testing improvements
npm install -D @vitest/coverage-v8

# No other new dependencies needed — everything else uses existing infrastructure
```

---

*Document compiled 2026-07-31. Source: AUDIT.md, PLAN.md, PATCH_CONTRACT.md + inline context.*
