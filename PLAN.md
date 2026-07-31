# Acode + OpenClaude Integration Plan

## Personal Vibe Coding Tool

---

## 0. Design Principles (Non-Negotiable)

1. **Acode is the source of truth.** OpenClaude never owns the project directly. It proposes changes; Acode applies them.
2. **Patch-based flow.** AI generates diffs/patches, Acode reviews, user approves, Acode writes files. No direct file writes from the AI side.
3. **Editor state is sacred.** Never lose unsaved user work. Always check for dirty state before applying patches.
4. **Offline-safe.** The app must not crash or corrupt data when the network drops mid-request.
5. **No monetization.** Personal tool only. No IAP, no analytics, no tracking.

---

## 1. Backend Architecture Decision

### Chosen: Node.js WebSocket Bridge (Fastest Path)

**Why this architecture:**
- OpenClaude is a Node.js CLI — running it as a child process or embedded Node service avoids rewriting in Java/Kotlin
- WebSocket gives real-time bidirectional communication between the Acode WebView (frontend) and the Node backend
- Acode already has `cordova-plugin-websocket` installed and an xterm.js terminal with WebSocket backend — the plumbing exists
- Node.js runs natively on Android via the proot/Alpine sandbox — OpenClaude already works there today
- No need for Android service binding, JNI, or native bridges

**Architecture diagram:**

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

**Key decisions:**
- Backend runs as a Node.js process started from the terminal init script
- WebSocket server listens on `localhost:9876` (loopback only)
- Frontend connects via the existing `cordova-plugin-websocket` or raw `WebSocket` API
- OpenClaude runs as a child process of the WebSocket server, not directly
- Context collection reads files via Node.js `fs` module (same proot filesystem)

---

## 2. API Contract Specification

### 2.1 WebSocket Protocol

All messages are JSON. Every request includes an `id` for correlation.

**Client → Server (Acode → Backend):**

```json
// Send a chat message
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

// Get context for AI
{
  "id": "uuid-3",
  "type": "context.get",
  "payload": {
    "cwd": "/public/myproject",
    "maxTokens": 8000
  }
}

// Cancel ongoing request
{
  "id": "uuid-4",
  "type": "chat.cancel",
  "payload": {}
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
  "id": "uuid-1",
  "type": "patch.ready",
  "payload": {
    "patchId": "patch-abc-123",
    "description": "Fixed null check in main.js",
    "files": [
      {
        "path": "src/main.js",
        "diff": "--- a/src/main.js\n+++ b/src/main.js\n@@ -42 +42 @@\n-const x = null;\n+const x = value ?? defaultVal;",
        "linesAdded": 1,
        "linesRemoved": 1
      }
    ]
  }
}

// Patch result
{
  "id": "uuid-2",
  "type": "patch.result",
  "payload": {
    "patchId": "patch-abc-123",
    "success": true,
    "message": "Patch applied successfully"
  }
}

// Error
{
  "id": "uuid-1",
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

### 2.2 File Sync Protocol

The frontend needs to know when files change on disk (from terminal/OpenClaude):

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

// Refresh request (client → server)
{
  "id": "uuid-5",
  "type": "fs.refresh",
  "payload": {
    "path": "/public/myproject"
  }
}
```

### 2.3 Error Codes

| Code | Meaning | Frontend Action |
|------|---------|-----------------|
| `NETWORK_ERROR` | WebSocket disconnected | Auto-reconnect with backoff, show toast |
| `API_ERROR` | Claude API returned error | Show error in chat, don't retry |
| `PATCH_CONFLICT` | Patch conflicts with local changes | Show conflict dialog, offer merge |
| `TOKEN_LIMIT` | Context too large for model | Auto-truncate, warn user |
| `TIMEOUT` | Request timed out (>60s) | Offer cancel/retry |
| `PROCESS_CRASH` | Backend Node process died | Restart backend, restore state |

---

## 3. UI/UX Integration Points

### 3.1 AI Chat Panel (Sidebar Tab)

**File:** `src/sidebarApps/index.js`
**Mechanism:** Register as a sidebar app

```javascript
import sidebarApps from "src/sidebarApps";

sidebarApps.add(
  "robot",           // icon CSS class
  "ai-chat",         // unique ID
  "AI Chat",         // tooltip
  (container) => {   // init function, receives <div> element
    // Build chat UI into container
    // Return cleanup function
    return () => { /* disconnect WebSocket, cleanup */ };
  },
  false,             // prepend (false = append to end)
  (container) => {   // onSelected callback
    // Focus input, scroll to bottom
  }
);
```

**Available icon classes:** Check `src/icons/` directory. Use `"robot"` or create a new AI icon.

### 3.2 AI Chat as Editor Tab (Alternative)

**File:** `src/lib/editorFile.js`

If you want AI chat as a full editor tab (instead of sidebar):

```javascript
const chatContent = document.createElement("div");
// Build chat UI into chatContent...

const chatFile = new EditorFile("AI Chat", {
  type: "page",       // Non-editor tab with Shadow DOM
  content: chatContent,
  tabIcon: "robot",
});
```

**Shadow DOM isolation** (lines ~520-540 of editorFile.js) ensures AI CSS doesn't leak.

### 3.3 Diff Viewer

**New dependency needed:** `npm install @codemirror/merge`

```javascript
import { MergeView } from "@codemirror/merge";

const mergeView = new MergeView({
  parent: diffContainer,
  original: originalContent,
  modified: patchedContent,
});
```

**Use case:** Show before/after diff when patch is ready for review.

### 3.4 Patch Approval Dialog

**File:** `src/dialogs/dialog.js` (base class)

```javascript
import dialog from "src/dialogs/dialogBox";

const patchDialog = new dialog("Patch Review", {
  // Custom content with diff view + accept/reject buttons
});
patchDialog.show();
```

Or use the simpler confirm flow:

```javascript
const confirm = acode.require("confirm");
const result = await confirm(
  "Apply Patch",
  "Apply changes to src/main.js?"
);
if (result) { /* apply patch */ }
```

### 3.5 Event System

**File:** `src/lib/editorManager.js`

Subscribe to events for context tracking:

```javascript
editorManager.on("switch-file", (file) => {
  // Update AI context with newly active file
});

editorManager.on("file-content-changed", (file) => {
  // Track unsaved changes, warn before patch apply
});

editorManager.on("new-file", (file) => {
  // Add to open files list for context
});
```

### 3.6 Notifications

**File:** `src/components/toast/index.js`

```javascript
import toast from "src/components/toast";

toast("Patch applied successfully", "success");
toast("AI request failed", "error");
toast("Reconnecting to backend...", "warning");
```

### 3.7 Theming

**File:** `src/theme/builder.js`

Use existing CSS variables for all AI components:

```css
.ai-chat-panel {
  background: var(--secondary-color);
  color: var(--secondary-text-color);
  border: 1px solid var(--border-color);
}
.ai-message-user {
  background: var(--active-color);
  color: var(--primary-text-color);
}
.ai-message-ai {
  background: var(--primary-color);
  color: var(--primary-text-color);
}
.ai-error { color: var(--error-text-color); }
.ai-success { color: var(--success-text-color); }
```

### 3.8 Key Bindings

**File:** `src/lib/keyBindings.js`

**Available Ctrl+ shortcuts:** Ctrl+G, Ctrl+D, Ctrl+L, Ctrl+E, Ctrl+M, Ctrl+B, Ctrl+N, Ctrl+K, Ctrl+I, Ctrl+U, Ctrl+Y, Ctrl+X, Ctrl+Q, Ctrl+R

**Recommended mapping:**
| Shortcut | Action |
|----------|--------|
| Ctrl+G | Toggle AI chat panel |
| Ctrl+E | Send selected code to AI |
| Ctrl+L | Clear AI chat |

Registration:

```javascript
keyBindings.addBinding({
  name: "toggleAiChat",
  description: "Toggle AI Chat Panel",
  key: "ctrl-g",
  action: () => { /* toggle sidebar */ },
});
```

---

## 4. Phased Development Roadmap

### Phase 0: Foundation (Week 1-2)
**Goal:** Get the project compiling and testing infrastructure in place.

| Task | Details | Files |
|------|---------|-------|
| 0.1 Fork Acode | Clone, create branch `ai-integration` | — |
| 0.2 Fix file sync | Add `refresh()` to openFolder.js, wire resumeHandler | `src/pages/fileBrowser/fileBrowser.js`, `src/main.js`, `src/lib/openFolder.js` |
| 0.3 Add npm test to CI | Add test job to ci.yml | `.github/workflows/ci.yml` |
| 0.4 Add test infrastructure | Create mocks, fixtures, setup file | `tests/__mocks__/`, `tests/fixtures/`, `tests/setup.js` |
| 0.5 Install @codemirror/merge | For diff viewer | `package.json` |
| 0.6 Clean licenses | Remove FTP/SFTP plugins, add font licenses | `src/plugins/ftp/`, `src/plugins/sftp/`, `src/res/fonts/` |

**Exit criteria:** `npm test` passes in CI, file sync works, no license risks.

### Phase 1: Backend Core (Week 3-4)
**Goal:** WebSocket server + OpenClaude child process management.

| Task | Details | Files |
|------|---------|-------|
| 1.1 WebSocket server | Node.js server on localhost:9876 | `src/ai/server.js` (new) |
| 1.2 OpenClaude manager | Spawn/kill child process, handle stdout/stderr | `src/ai/openClaudeManager.js` (new) |
| 1.3 Message router | Parse WebSocket messages, route to handlers | `src/ai/messageRouter.js` (new) |
| 1.4 Context collector | Gather open files, selection, project structure | `src/ai/contextCollector.js` (new) |
| 1.5 Patch manager | Parse unified diffs, validate, apply via Acode FS | `src/ai/patchManager.js` (new) |
| 1.6 Integration with terminal | Start backend from init-alpine.sh | `src/plugins/terminal/scripts/init-alpine.sh` |
| 1.7 Unit tests | Test each module | `tests/unit/ai/*.test.js` |

**Exit criteria:** Backend starts, accepts WebSocket connections, can spawn OpenClaude, send/receive messages.

### Phase 2: Frontend Chat UI (Week 5-6)
**Goal:** AI chat panel in sidebar with basic send/receive.

| Task | Details | Files |
|------|---------|-------|
| 2.1 Sidebar app registration | Register AI chat tab | `src/sidebarApps/ai/index.js` (new) |
| 2.2 Chat UI components | Message list, input box, send button | `src/sidebarApps/ai/chat.js` (new) |
| 2.3 WebSocket client | Connect to backend, handle messages | `src/ai/websocket.js` (new) |
| 2.4 Message rendering | Markdown support, code highlighting | Uses existing markdown-it |
| 2.5 Streaming display | Show AI response as it streams in | `src/sidebarApps/ai/chat.js` |
| 2.6 Connection status | Show connected/disconnected state | `src/sidebarApps/ai/status.js` (new) |
| 2.7 Keybinding | Ctrl+G to toggle chat | `src/lib/keyBindings.js` |
| 2.8 SCSS styling | AI panel theme using CSS variables | `src/styles/ai.scss` (new) |

**Exit criteria:** User can type a message, see AI response streaming in the sidebar.

### Phase 3: Patch Flow (Week 7-8)
**Goal:** AI proposes changes, user reviews and applies.

| Task | Details | Files |
|------|---------|-------|
| 3.1 Diff viewer | Install @codemirror/merge, render diffs | `src/ai/diffViewer.js` (new) |
| 3.2 Patch dialog | Custom dialog with diff + approve/reject | `src/ai/patchDialog.js` (new) |
| 3.3 Patch application | Apply accepted patches via Acode FS | `src/ai/patchManager.js` |
| 3.4 Conflict handling | Detect and resolve conflicts | `src/ai/conflictResolver.js` (new) |
| 3.5 Undo support | Revert applied patches | `src/ai/patchHistory.js` (new) |
| 3.6 File browser refresh | Auto-refresh after patch apply | Wire into `src/lib/openFolder.js` |
| 3.7 Editor reload | Reload open files after patch apply | Wire into `src/lib/editorManager.js` |

**Exit criteria:** Full patch cycle works: AI suggests → user sees diff → user approves → file updates → editor refreshes.

### Phase 4: Polish & Hardening (Week 9-10)
**Goal:** Production-quality stability.

| Task | Details | Files |
|------|---------|-------|
| 4.1 Error handling | Network drops, API errors, crashes | All AI modules |
| 4.2 Auto-reconnect | WebSocket reconnection with backoff | `src/ai/websocket.js` |
| 4.3 Token management | Track usage, warn on limits | `src/ai/tokenManager.js` (new) |
| 4.4 Settings UI | API key, model selection, preferences | `src/ai/settings.js` (new) |
| 4.5 Conversation history | Persist chat across sessions | `src/ai/conversationStore.js` (new) |
| 4.6 Memory/context | Remember project context across requests | `src/ai/contextCollector.js` |
| 4.7 Mobile optimizations | Touch-friendly UI, keyboard handling | SCSS + JS adjustments |
| 4.8 Integration tests | Full flow tests | `tests/integration/ai.test.js` |
| 4.9 Android E2E tests | On-device test harness | `src/test/ai.tests.js` |

**Exit criteria:** App handles edge cases gracefully, settings persist, conversation history works.

---

## 5. File Structure

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
├── sidebarApps/
│   └── ai/                      # AI chat sidebar
│       ├── index.js             # Sidebar registration
│       ├── chat.js              # Chat UI
│       └── status.js            # Connection status
├── styles/
│   └── ai.scss                  # AI-specific styles
tests/
├── __mocks__/                   # Mock modules
│   ├── editorManager.js
│   ├── cordova-fs.js
│   └── claude-api.js
├── fixtures/                    # Test data
│   ├── patches/
│   ├── ai-responses/
│   └── files/
├── unit/
│   └── ai/                      # AI module tests
│       ├── patchManager.test.js
│       ├── contextCollector.test.js
│       ├── messageRouter.test.js
│       └── tokenManager.test.js
├── integration/
│   └── ai.test.js               # Full flow tests
└── setup.js                     # Global test setup
```

---

## 6. Testing Strategy

### 6.1 Current State

| Category | Status |
|----------|--------|
| Test framework | Vitest 4.1.10 configured |
| Unit tests | 11 files in `tests/unit/` (pure utilities only) |
| In-app tests | 9 files in `src/test/` (custom harness, not CI-runnable) |
| CI test execution | **MISSING** — no `npm test` in CI |
| Coverage | **MISSING** — no configuration |
| Mocks | **MISSING** — zero mocks in codebase |
| Fixtures | **MISSING** — no fixtures directory |

### 6.2 Testing Strategy

**Layer 1: Unit Tests (Vitest)**
- Run in CI on every PR
- Mock-heavy: mock Claude API, filesystem, editorManager
- Fast feedback (< 30 seconds)
- Target: 80%+ coverage on `src/ai/` modules

**Layer 2: Integration Tests (Vitest)**
- Test WebSocket server ↔ client communication
- Test patch flow end-to-end with temp files
- Run weekly or before releases

**Layer 3: In-App Tests (Custom Harness)**
- Extend existing `src/test/tester.js` framework
- Test on real Android device/emulator
- Cover: AI panel rendering, diff viewer, patch dialog, keyboard shortcuts

**Layer 4: Manual Testing Checklist**
- Start backend from terminal
- Send AI message, verify streaming response
- Apply patch, verify file updates
- Switch files, verify context updates
- Kill backend, verify reconnect
- Rotate device, verify UI survives

### 6.3 Mock Strategy

```javascript
// tests/__mocks__/editorManager.js
export default {
  editor: { getValue: () => "mock content", dispatch: vi.fn() },
  on: vi.fn(),
  getFile: vi.fn(),
  getFiles: () => [],
};

// tests/__mocks__/cordova-fs.js
export default {
  readFile: vi.fn().mockResolvedValue("file content"),
  writeFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
};
```

### 6.4 CI Integration

Add to `.github/workflows/ci.yml`:

```yaml
test:
  name: Unit Tests
  timeout-minutes: 10
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: 20
        cache: npm
    - run: npm ci --no-audit --no-fund
    - run: npm test
```

### 6.5 Vitest Config Updates

```javascript
// vitest.config.js additions
test: {
  include: ["tests/**/*.test.{js,ts}"],
  setupFiles: ["tests/setup.js"],
  environment: "node",
  coverage: {
    provider: "v8",
    reporter: ["text", "lcov", "html"],
    include: ["src/ai/**"],
    exclude: ["src/test/**", "src/plugins/**"],
  },
},
```

---

## 7. Data Models

### 7.1 Chat Message

```javascript
{
  id: "msg-uuid",
  role: "user" | "assistant" | "system",
  content: "string",
  timestamp: 1722412800000,
  patches: ["patch-id-1"],    // associated patches, if any
  usage: {
    inputTokens: 1200,
    outputTokens: 800,
  },
}
```

### 7.2 Patch

```javascript
{
  id: "patch-uuid",
  description: "Fixed null check",
  status: "pending" | "accepted" | "rejected" | "applied" | "failed",
  files: [
    {
      path: "src/main.js",
      diff: "unified diff string",
      original: "original content",
      modified: "patched content",
    }
  ],
  createdAt: 1722412800000,
  appliedAt: null,
  conversationId: "conv-uuid",
}
```

### 7.3 Conversation

```javascript
{
  id: "conv-uuid",
  title: "Fix the login bug",
  messages: [/* ChatMessage[] */],
  patches: [/* Patch[] */],
  context: {
    cwd: "/public/myproject",
    files: ["src/main.js", "src/utils.js"],
  },
  createdAt: 1722412800000,
  updatedAt: 1722413000000,
}
```

### 7.4 AI Settings

```javascript
{
  apiKey: "sk-...",              // stored securely via cordova-plugin-prefs
  model: "claude-sonnet-4-20250514",
  maxTokens: 8192,
  temperature: 0.7,
  autoApply: false,              // require manual approval
  contextFiles: true,            // include open files in context
  contextSelection: true,        // include selection in context
}
```

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Android kills background Node process | Restart on WebSocket reconnect, persist state to disk |
| Token limit exceeded mid-conversation | Auto-truncate old messages, warn user |
| Patch conflicts with unsaved editor | Check dirty state, prompt save before apply |
| Network drops during AI request | Queue request, retry with exponential backoff |
| OpenClaude process crashes | Restart child process, offer "reset conversation" |
| Large repo context explosion | Limit to open files + selection, not full project |
| musl/glibc mismatch in proot | OpenClaude already uses Node.js which bundles its own libc |
| Prompt injection via file contents | Sanitize context, never execute AI-generated shell commands |

---

## 9. Dependencies to Install

```bash
# Diff viewer
npm install @codemirror/merge

# Testing improvements
npm install -D @vitest/coverage-v8

# No other new dependencies needed — everything else uses existing infrastructure
```

---

## 10. Quick Start Checklist

- [ ] Fork Acode, create `ai-integration` branch
- [ ] Run `npm test` to verify existing tests pass
- [ ] Add `npm test` to CI workflow
- [ ] Fix file sync (refresh mechanism)
- [ ] Install `@codemirror/merge`
- [ ] Create `src/ai/` directory structure
- [ ] Implement WebSocket server (Phase 1)
- [ ] Implement sidebar AI chat (Phase 2)
- [ ] Implement patch flow (Phase 3)
- [ ] Polish and harden (Phase 4)
- [ ] Test on physical Android device
