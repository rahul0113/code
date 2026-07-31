/**
 * messageRouter.js - Routes WebSocket messages between frontend and backend.
 *
 * Handles:
 * - connect/disconnect: Manage OpenClaude process lifecycle
 * - prompt: Send user prompt, run agentic loop (tool execution + streaming)
 * - apply_patch / reject_patch: Handle patch approval flow
 * - cancel: Cancel running operations
 */

const { parseStreamLine } = require("../lib/claude/cliParser");
const { ToolExecutor } = require("./toolExecutor");
const { ContextCollector } = require("./contextCollector");

function createMessageRouter({ openClaude, patchManager }) {
  let cancelRef = { cancelled: false };
  let workspacePath = "/public";
  /** @type {{resolve: Function, toolCall: object, pendingPatch: object}|null} */
  let pendingApproval = null;

  async function handleMessage(ws, message) {
    const { type } = message;

    switch (type) {
      case "connect":
        return handleConnect(ws, message);

      case "disconnect":
        return handleDisconnect(ws);

      case "prompt":
        return handlePrompt(ws, message);

      case "apply_patch":
        return handleApplyPatch(ws, message);

      case "reject_patch":
        return handleRejectPatch(ws, message);

      case "cancel":
        return handleCancel(ws);

      default:
        ws.send(JSON.stringify({
          type: "error",
          message: `Unknown message type: ${type}`,
        }));
    }
  }

  async function handleConnect(ws, message) {
    const options = message.options || {};
    workspacePath = options.cwd || "/public";
    openClaude.spawn(options);
    ws.send(JSON.stringify({ type: "connected", version: "1.0.0" }));
  }

  async function handleDisconnect(ws) {
    cancelRef.cancelled = true;
    openClaude.kill();
    ws.send(JSON.stringify({ type: "disconnected" }));
  }

  async function handlePrompt(ws, message) {
    if (!openClaude.isRunning()) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Not connected. Send 'connect' first.",
      }));
      return;
    }

    cancelRef.cancelled = false;
    ws.send(JSON.stringify({ type: "streaming", status: "started" }));

    try {
      const collector = new ContextCollector(workspacePath);
      const context = collector.collect(workspacePath);
      const contextStr = collector.formatContext(context);

      const fullPrompt = contextStr
        ? `${contextStr}\n\nUser request: ${message.prompt}`
        : message.prompt;

      openClaude.sendInput(fullPrompt);

      await runAgenticLoop(ws);
    } catch (err) {
      ws.send(JSON.stringify({
        type: "error",
        message: err.message,
      }));
    } finally {
      ws.send(JSON.stringify({ type: "streaming", status: "done" }));
    }
  }

  /**
   * Agentic loop: reads stdout line-by-line, executes tool calls,
   * feeds results back, and streams text deltas to the frontend.
   */
  function runAgenticLoop(ws) {
    return new Promise((resolve, reject) => {
      let buffer = "";
      let resolved = false;

      function finish(err) {
        if (resolved) return;
        resolved = true;
        openClaude.process?.stdout?.removeListener("data", onData);
        if (err) reject(err);
        else resolve();
      }

      function onData(chunk) {
        if (cancelRef.cancelled) {
          finish(new Error("Cancelled"));
          return;
        }

        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (cancelRef.cancelled) {
            finish(new Error("Cancelled"));
            return;
          }

          const parsed = parseStreamLine(line);
          if (!parsed) continue;

          switch (parsed.type) {
            case "text_delta":
              ws.send(JSON.stringify({
                type: "text_delta",
                content: parsed.content,
              }));
              break;

            case "tool_use":
              // executeTool may pause for patch approval
              executeTool(ws, parsed);
              break;

            case "result":
              ws.send(JSON.stringify({
                type: "result",
                subtype: parsed.subtype,
                costUsd: parsed.costUsd,
              }));
              finish();
              return;
          }
        }
      }

      if (!openClaude.process || !openClaude.process.stdout) {
        finish(new Error("Process not running"));
        return;
      }

      openClaude.process.stdout.on("data", onData);
    });
  }

  /**
   * Execute a tool call. For apply_patch, pauses the loop for user approval.
   */
  async function executeTool(ws, toolCall) {
    ws.send(JSON.stringify({
      type: "tool_start",
      id: toolCall.id,
      name: toolCall.name,
    }));

    const executor = new ToolExecutor({
      workspacePath,
      patchManager,
    });

    const result = await executor.execute(toolCall);

    // If this is a patch requiring approval, pause and wait
    if (result.pendingPatch) {
      ws.send(JSON.stringify({
        type: "patch_proposed",
        patchId: result.pendingPatch.id,
        filePath: result.pendingPatch.filePath,
        old: result.pendingPatch.old,
        new: result.pendingPatch.new,
      }));

      // Wait for user to approve/reject
      const approved = await new Promise((resolve) => {
        pendingApproval = {
          resolve,
          toolCall,
          pendingPatch: result.pendingPatch,
        };
      });

      if (approved) {
        const applyResult = patchManager.apply(result.pendingPatch);
        ws.send(JSON.stringify({
          type: "patch_result",
          patchId: result.pendingPatch.id,
          success: applyResult.success,
          error: applyResult.error,
        }));
        feedResult(ws, toolCall.id, applyResult.success
          ? `Patch applied to ${applyResult.filePath}`
          : `Patch failed: ${applyResult.error}`);
      } else {
        ws.send(JSON.stringify({
          type: "patch_result",
          patchId: result.pendingPatch.id,
          success: false,
          error: "Rejected by user",
        }));
        feedResult(ws, toolCall.id, "Patch rejected by user");
      }
      return;
    }

    ws.send(JSON.stringify({
      type: "tool_result",
      id: toolCall.id,
      name: toolCall.name,
      output: result.output,
      error: result.error,
    }));

    feedResult(ws, toolCall.id, result.error || result.output);
  }

  function feedResult(ws, toolUseId, content) {
    const toolResult = {
      type: "tool_result",
      tool_use_id: toolUseId,
      content,
    };
    openClaude.writeToolResult(JSON.stringify(toolResult));
  }

  async function handleApplyPatch(ws, message) {
    // Direct apply (from user action outside agentic loop)
    if (pendingApproval) {
      pendingApproval.resolve(true);
      pendingApproval = null;
      return;
    }

    const { patchId, filePath, old, new: newContent } = message;
    const result = patchManager.apply({ filePath, old, new: newContent });
    ws.send(JSON.stringify({
      type: "patch_result",
      patchId,
      success: result.success,
      error: result.error,
    }));
  }

  async function handleRejectPatch(ws, message) {
    if (pendingApproval) {
      pendingApproval.resolve(false);
      pendingApproval = null;
      return;
    }

    const { patchId } = message;
    patchManager.reject(patchId);
    ws.send(JSON.stringify({
      type: "patch_result",
      patchId,
      success: false,
      error: "Patch rejected by user",
    }));
  }

  async function handleCancel(ws) {
    cancelRef.cancelled = true;
    openClaude.kill();
    ws.send(JSON.stringify({ type: "cancelled" }));
  }

  return { handleMessage };
}

module.exports = { createMessageRouter };
