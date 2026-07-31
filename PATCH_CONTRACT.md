# Patch Application Contract

## The Complete Lifecycle: Prompt → Safe Apply or Reject

This document defines exact behavior for every edge case. Implement in this order. No exceptions.

---

## 1. Frozen MVP Scope

**In scope for v1:**

| # | Feature | Gate |
|---|---------|------|
| 1 | Connect backend (WebSocket start + health ping) | Backend connects, stays connected 10 min |
| 2 | Send chat message | Message reaches OpenClaude |
| 3 | Receive streaming response | Full response rendered in chat UI |
| 4 | Generate patch | Unified diff produced from AI response |
| 5 | Review patch | Diff shown in approval dialog |
| 6 | Apply patch safely | File written, conflict-free or blocked |
| 7 | Refresh editor + file tree | Editor reloads, sidebar updates |
| 8 | Undo/rollback | Last AI change reverted |

**Postponed (not v1):**

- Conversation history persistence
- Multi-file patch batching (single file first)
- Token usage tracking / budget
- Settings UI (API key hardcoded for now, moved to secure storage later)
- Context collection beyond open files + selection
- Auto-apply (always manual approval in v1)
- Conflict resolver UI (block and notify in v1)
- Android emulator CI tests
- E2E test harness

---

## 2. State Machine: Prompt to Apply

```
                          ┌─────────────┐
                          │    IDLE     │
                          └──────┬──────┘
                                 │ user sends prompt
                                 ▼
                          ┌─────────────┐
                     ┌────│  SENDING    │────┐
                     │    └─────────────┘    │
                     │ success               │ network error
                     ▼                       ▼
              ┌─────────────┐         ┌─────────────┐
              │  STREAMING  │         │ RETRY_QUEUE │
              └──────┬──────┘         └──────┬──────┘
                     │ done                  │ retry success
                     ▼                       ▼
              ┌─────────────┐         ┌─────────────┐
              │ PATCH_READY │         │  SENDING    │
              └──────┬──────┘         └─────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
   ┌───────────┐ ┌────────┐ ┌────────┐
   │  ACCEPTED │ │REJECTED│ │ CANCEL │
   └─────┬─────┘ └────────┘ └────────┘
         │
         ▼
   ┌───────────┐         ┌──────────────┐
   │PRE_SNAP   │────────▶│ APPLYING     │
   └───────────┘         └──────┬───────┘
                           ┌────┴────┐
                           ▼         ▼
                    ┌──────────┐ ┌──────────┐
                    │ APPLIED  │ │  FAILED  │
                    └────┬─────┘ └────┬─────┘
                         │            │
                         ▼            ▼
                    ┌──────────┐ ┌──────────┐
                    │REFRESHING│ │ROLLBACK  │
                    └────┬─────┘ └────┬─────┘
                         │            │
                         ▼            ▼
                    ┌──────────┐ ┌──────────┐
                    │   IDLE   │ │   IDLE   │
                    └──────────┘ └──────────┘
```

### State Descriptions

| State | What happens | Timeout |
|-------|-------------|---------|
| `IDLE` | Waiting for user input. No active request. | — |
| `SENDING` | WebSocket message dispatched, waiting for first chunk | 30s → error |
| `STREAMING` | Receiving AI response chunks, rendering in chat | 120s total → cancel |
| `RETRY_QUEUE` | Network error, waiting to retry | 1s → 2s → 4s → 8s → fail |
| `PATCH_READY` | Full diff generated, awaiting user review | No timeout |
| `ACCEPTED` | User approved patch, pre-patch snapshot taken | — |
| `REJECTED` | User rejected patch. Return to IDLE. | — |
| `CANCEL` | User cancelled during streaming. Cleanup. | — |
| `PRE_SNAP` | Saving file backup before patch | 5s → abort patch |
| `APPLYING` | Writing patched file via Acode FS | 10s → abort |
| `APPLIED` | File written successfully | — |
| `FAILED` | Patch write failed. Trigger rollback. | — |
| `ROLLBACK` | Restoring from pre-patch snapshot | 5s → crash recovery |
| `REFRESHING` | Reloading editor buffer + file tree | 3s → skip, retry later |

---

## 3. Patch Application Rules

### 3.1 Pre-conditions (Check Before Any Patch)

```
1. Is the target file still open in the editor?
   YES → check buffer state
   NO  → check disk state

2. Has the file been modified on disk since the request started?
   YES → BLOCK patch, notify user: "File changed externally since request started"
   NO  → continue

3. Is the editor buffer dirty (unsaved changes)?
   YES → BLOCK patch, notify user: "Unsaved changes in [filename]. Save first."
   NO  → continue

4. Does the patch target lines that exist in the current buffer?
   YES → continue
   NO  → BLOCK patch, notify user: "Patch targets lines that no longer exist. The file may have been edited."
```

### 3.2 Patch Types

| Type | Detection | Action |
|------|-----------|--------|
| **Modify** | Path exists on disk, patch has `-/+` lines | Backup → apply diff → write |
| **Create** | Path does NOT exist, patch is all `+` lines | Backup parent dir → create file → write |
| **Delete** | Path exists, patch removes entire content | Backup file → delete |
| **Rename** | (v1: BLOCK) | Notify: "Rename patches not supported in v1" |

### 3.3 Application Sequence

```
Step 1: VALIDATE
  - Parse unified diff
  - Check all target paths exist (for modify/delete) or don't exist (for create)
  - Check line numbers match current file content
  - If ANY check fails → ABORT, notify user with specific failure

Step 2: SNAPSHOT
  - Read current file content from Acode editor buffer (NOT disk)
  - Store in PatchHistory: { patchId, path, originalContent, timestamp }
  - This is the rollback source

Step 3: APPLY
  - For modify: Apply diff to current buffer content
  - For create: Use new content from patch
  - For delete: Set content to empty, mark for removal
  - Write via Acode's fsOperation() (same path as normal file save)
  - Use the EDITOR BUFFER as source, not disk file

Step 4: VERIFY
  - Read back the written file
  - Compare with expected result
  - If mismatch → ROLLBACK immediately

Step 5: REFRESH
  - If file is open in editor:
    - Reload editor buffer: editor.setValue(newContent)
    - Mark as saved (not dirty)
  - If file is in file tree:
    - Clear fileBrowser cache for parent directory
    - Trigger sidebar refresh
  - Emit "file-content-changed" event
```

### 3.4 Partial Patch Failure

A patch may touch multiple files. v1 behavior:

```
For each file in patch:
  1. Validate (step 1)
  2. Snapshot (step 2)
  3. Apply (step 3)
  4. Verify (step 4)

IF any file fails:
  - STOP processing remaining files
  - ROLLBACK all files that were already applied (in reverse order)
  - Notify user: "Patch failed on [filename]: [reason]. All changes rolled back."
  - No partial application allowed in v1
```

### 3.5 Binary Files

```
IF patch targets a binary file (detected by file extension or content check):
  - BLOCK patch
  - Notify user: "Cannot patch binary file: [filename]"
  - Suggest: "Download or replace manually"
```

### 3.6 New Files (Create)

```
1. Check parent directory exists
2. If parent doesn't exist → create it first (mkdir -p equivalent via Acode FS)
3. Check file doesn't already exist (exclusive create)
4. If file exists → BLOCK, notify user
5. Write file
6. Refresh file tree to show new file
```

---

## 4. Backend Lifecycle & Supervision

### 4.1 Startup Sequence

```
1. init-alpine.sh runs
2. Check if Node.js is installed: `command -v node`
   - If missing → install via apk add nodejs npm
3. Check if backend server file exists: `$PREFIX/ai-backend/server.js`
   - If missing → skip (first run, no AI backend yet)
4. Start backend: `node $PREFIX/ai-backend/server.js &`
   - Capture PID to `$PREFIX/ai-backend.pid`
   - Redirect stdout/stderr to `$PREFIX/ai-backend.log`
5. Wait up to 3s for WebSocket port to be open
   - Check: `nc -z localhost 9876`
   - If open → continue
   - If not → log error, continue without AI backend
6. Frontend connects on next WebView load
```

### 4.2 Health Ping

```
Frontend sends every 30 seconds:
  { type: "server.ping" }

Backend responds:
  { type: "server.pong", uptime: 3600 }

If no pong received within 5 seconds:
  → Mark backend as disconnected
  → Show toast: "AI backend disconnected"
  → Enter reconnect loop
```

### 4.3 Reconnect Logic

```
On disconnect:
  attempt = 0
  maxAttempts = 10
  baseDelay = 1000  // 1 second

  loop:
    attempt++
    delay = baseDelay * 2^(attempt-1)  // exponential backoff
    delay = min(delay, 30000)           // cap at 30s

    sleep(delay)
    try WebSocket connect

    if connected:
      → Send any queued messages
      → Resume normal operation
      break

    if attempt >= maxAttempts:
      → Show toast: "AI backend unreachable. Restart terminal."
      → Disable AI features until manual reconnect
      break
```

### 4.4 Process Restart Rules

```
Backend process exits unexpectedly:
  1. Check exit code
     - 0 → clean shutdown, don't restart
     - 1 → error, restart once
     - 137 (SIGKILL) → Android killed it, restart once

  2. If restart needed:
     - Kill any zombie process on port 9876
     - Start new instance
     - Wait for health ping
     - If healthy → restore state from disk (if any was saved)

  3. If restart fails:
     → Log to $PREFIX/ai-backend.log
     → Show toast: "AI backend crashed. Check logs."
     → Disable AI features until terminal restart
```

### 4.5 State Recovery After Android Kill

```
Android may kill the Node process at any time (memory pressure, Doze mode).

On backend startup:
  1. Check for state file: $PREFIX/ai-backend/state.json
     - Contains: pending patch (if any), last conversation ID, settings

  2. If state.json exists:
     - Load pending patch
     - If patch was in APPLYING state → ROLLBACK (incomplete write)
     - If patch was in PRE_SNAP state → discard (snapshot incomplete)
     - If patch was in ACCEPTED state → re-prompt user: "Patch was interrupted. Apply now?"

  3. Delete state.json after recovery

  4. Frontend on reconnect:
     - Clear any in-progress streaming display
     - Show toast: "AI backend reconnected"
     - Resume from IDLE state
```

### 4.6 Log Capture

```
All backend logs go to: $PREFIX/ai-backend.log

Log format:
  [ISO timestamp] [level] message

Levels: DEBUG, INFO, WARN, ERROR

Critical logs (always captured):
  - Backend start/stop
  - WebSocket connect/disconnect
  - API key usage (masked: sk-...xxxx)
  - Patch apply/rollback
  - Process crash/exit

Frontend can request logs:
  { type: "server.logs", payload: { lines: 100 } }
  → Returns last N lines of log file
```

---

## 5. Security & Secrets Handling

### 5.1 API Key Storage

**v1 approach (simple, accept risk for personal use):**

```
Store in: $PREFIX/ai-backend/config.json
Content: { "apiKey": "sk-ant-...", "model": "claude-sonnet-4-20250514" }
Permissions: chmod 600 (owner read/write only)
Location: Inside app private storage, NOT on /sdcard
```

**Why this works for personal use:**
- App private storage is not accessible to other apps (Android sandbox)
- Root users can access anything anyway — no defense against rooted device
- The key never leaves the device (only sent to api.anthropic.com over TLS)

**Future hardening (if needed later):**
- Android Keystore for encryption at rest
- Encrypt config.json with device-derived key
- Never log the key (mask in all log output)

### 5.2 Key Handling Rules

```
1. NEVER log the API key
   - All log output must mask: sk-ant-...xxxx (last 4 chars only)

2. NEVER send the key in WebSocket messages
   - Backend holds the key, frontend never sees it
   - Frontend connects to localhost backend, backend proxies to Claude API

3. NEVER store the key in:
   - localStorage
   - URL parameters
   - Toast/notification messages
   - Error reports

4. Key rotation:
   - User can update key via config file edit
   - Backend re-reads config on restart
   - No hot-reload of keys in v1
```

### 5.3 Preventing Plugin Access

```
The AI backend config file is at: $PREFIX/ai-backend/config.json

Acode plugins run in the WebView context and cannot access Node.js filesystem directly.
The config file is only accessible via:
  - Node.js fs module (backend only)
  - Android filesystem (requires root or app permission)

No additional protection needed beyond filesystem permissions for v1.
```

### 5.4 Input Sanitization

```
User input to AI:
  - Strip any terminal escape sequences (OSC, CSI)
  - Limit message length to 10,000 characters
  - No sanitization of code snippets (AI needs raw code)

AI output to apply:
  - Validate diff format before parsing
  - Reject patches containing shell injection patterns in filenames
  - Never execute AI-generated shell commands
  - Never use AI-generated paths without validation
```

---

## 6. Context Selection Policy

### 6.1 What Gets Sent Every Time

```
Always included:
  1. User's message (the prompt)
  2. Active file path (name only, no content unless requested)
  3. Working directory path
  4. Project type (detected from package.json, Cargo.toml, etc.)
  5. List of open file names (paths only, not content)
```

### 6.2 What Gets Sent On Demand

```
Included when relevant:
  1. Active file CONTENT — when user selects code and asks about it
  2. Selected text — when there's an active selection
  3. Other open file CONTENT — only if user explicitly includes them
  4. File tree (top 2 levels) — when user asks about project structure
  5. Error messages — when user pastes an error
```

### 6.3 What NEVER Gets Sent

```
Never included:
  1. API key or credentials
  2. .env files or secrets
  3. node_modules contents
  4. Build output (dist/, build/, www/)
  5. Binary files
  6. Files > 100KB
  7. Git history (git log output)
  8. Other users' code or data
```

### 6.4 Limits

```
Hard limits:
  - Max files with content: 5
  - Max total tokens: 8,000 (of model's context window)
  - Max single file content: 4,000 tokens
  - Max selected text: 2,000 tokens
  - Max file tree depth: 2 levels
  - Max file tree entries: 50

Soft limits:
  - Prefer fewer, more relevant files
  - Rank by: active file > selected files > similar name > recent > random
```

### 6.5 When to Stop Expanding Context

```
Stop adding files when:
  1. Total token count exceeds 8,000
  2. File count reaches 5
  3. User's message is already clear without more context
  4. Remaining files are not relevant to the request

Truncation strategy:
  - If single file exceeds 4,000 tokens → truncate, add note: "[truncated, showing first N lines]"
  - If total exceeds 8,000 → drop lowest-ranked files first
  - Never drop the active file or selected text
```

---

## 7. Rollback Strategy

### 7.1 Pre-Patch Snapshot

```
Before ANY patch application:
  1. Read current file content from EDITOR BUFFER (not disk)
  2. Store in PatchHistory:
     {
       patchId: "patch-uuid",
       filePath: "src/main.js",
       originalContent: "... full file content ...",
       timestamp: 1722412800000,
       source: "editor-buffer"  // or "disk" if file not open
     }
  3. Keep maximum 20 snapshots (FIFO, oldest deleted)
  4. Snapshots stored in memory only (not persisted to disk in v1)
```

### 7.2 Rollback Procedure

```
On user request "revert last AI change":
  1. Get latest PatchHistory entry
  2. Write originalContent back to filePath via Acode FS
  3. If file is open in editor:
     - Reload buffer: editor.setValue(originalContent)
     - Mark as saved
  4. Refresh file tree
  5. Remove from PatchHistory
  6. Show toast: "Reverted [filename]"

On crash recovery:
  1. If backend restarts with pending patch in state:
     - If patch was partially applied → rollback all files
     - If patch was fully applied but not verified → rollback all files
     - If patch was verified and applied → no rollback needed
  2. Show toast: "Recovered from crash. [N] changes reverted."
```

### 7.3 Crash Recovery

```
State persistence:
  - Before each patch apply, write to $PREFIX/ai-backend/state.json:
    {
      "pendingPatch": {
        "patchId": "...",
        "status": "applying",
        "files": [...]
      }
    }
  - After patch complete, delete state.json

On backend restart:
  1. Check state.json exists
  2. If yes:
     - If status was "applying" → rollback all files in patch
     - Delete state.json
  3. If no → clean start
```

---

## 8. File State Source of Truth

### 8.1 Priority Order

```
When there's a conflict between states, use this priority:

1. EDITOR BUFFER (highest priority)
   - The user is actively editing this file
   - Buffer is the most up-to-date version
   - Always read from here when available

2. DISK STATE
   - File exists on disk but not open in editor
   - Use Acode's fsOperation() to read
   - May be stale if another process modified it

3. AI PATCH STATE
   - The patch was generated against a snapshot of the file
   - The snapshot may be outdated if user edited after request started
   - ALWAYS validate patch against current editor buffer before applying

4. GIT STATE (lowest priority, informational only)
   - Used for context and display only
   - Never used as source for patch application in v1
```

### 8.2 Conflict Detection Matrix

```
┌────────────────────┬───────────────┬──────────────┬────────────────┐
│ Editor Buffer      │ Disk State    │ Patch Expects │ Action         │
├────────────────────┼───────────────┼──────────────┼────────────────┤
│ Clean, matches disk│ Unchanged     │ Matches disk  │ APPLY          │
│ Clean, matches disk│ Changed       │ Matches disk  │ BLOCK: "File   │
│                    │               │               │ changed on disk"│
│ Dirty (unsaved)    │ Unchanged     │ Any           │ BLOCK: "Save   │
│                    │               │               │ first"         │
│ Clean, differs disk│ Any           │ Any           │ Use buffer as  │
│                    │               │               │ source, APPLY  │
│ File not open      │ Exists        │ Matches disk  │ APPLY          │
│ File not open      │ Exists        │ Changed       │ BLOCK: "File   │
│                    │               │               │ changed"       │
│ File not open      │ Doesn't exist │ Is create     │ APPLY          │
│ File not open      │ Doesn't exist │ Is modify     │ BLOCK: "File   │
│                    │               │               │ not found"     │
└────────────────────┴───────────────┴──────────────┴────────────────┘
```

---

## 9. Phase Exit Criteria (Hard Gates)

### Phase 0: Foundation
```
□ npm test passes in CI
□ File sync works: create file in terminal → appears in file browser
□ No license risks (FTP/SFTP removed, fonts have licenses)
```

### Phase 1: Backend Core
```
□ WebSocket connects and stays connected for 10 minutes
□ Backend survives 5 rapid connect/disconnect cycles
□ OpenClaude child process starts, responds to ping, can be restarted
□ State recovery: kill backend → restart → pending patch rolled back
```

### Phase 2: Frontend Chat
```
□ Send message → receive full streaming response → render in chat
□ Backend disconnect → toast shown → auto-reconnect within 30s
□ Ctrl+G toggles chat panel open/closed
□ AI panel does not break when switching between files
```

### Phase 3: Patch Flow
```
□ Patch apply survives unsaved buffer conflict (blocked with message)
□ Patch apply survives file-rename-during-request (blocked with message)
□ Patch apply with 2-file patch, second file fails → both rolled back
□ Undo reverts last AI change completely
□ App resumes after backend kill without losing pending patch
```

### Phase 4: Polish
```
□ API key stored in config.json, never logged
□ Context never exceeds 8,000 tokens
□ 20+ unit tests for AI modules passing
□ Full flow test: prompt → stream → patch → apply → undo → done
```

---

## 10. Implementation Order

Build in this exact sequence. Each step must pass its gate before moving on.

```
1. WebSocket server (server.js) + health ping
2. Frontend WebSocket client (websocket.js)
3. Chat UI (sidebar app, message rendering)
4. OpenClaude manager (spawn, pipe, restart)
5. Context collector (open files, selection)
6. Patch manager (parse diff, validate)
7. Pre-patch snapshot + PatchHistory
8. Patch apply via Acode FS
9. Editor buffer reload after apply
10. File tree refresh after apply
11. Rollback mechanism
12. Conflict detection (all 8 matrix cases)
13. Config file for API key
14. Unit tests for each module
15. Integration test for full flow
```

Stop after step 15. That is v1.
