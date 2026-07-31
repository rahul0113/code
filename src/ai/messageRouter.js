/**
 * messageRouter.js - Routes WebSocket messages between frontend and backend.
 *
 * Handles:
 * - connect/disconnect: Manage OpenClaude process lifecycle
 * - prompt: Send user prompt to OpenClaude, stream response back
 * - apply_patch / reject_patch: Handle patch approval flow
 * - cancel: Cancel running operations
 */

function createMessageRouter({ openClaude, patchManager }) {
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
    openClaude.spawn(options);
    ws.send(JSON.stringify({ type: "connected", version: "1.0.0" }));
  }

  async function handleDisconnect(ws) {
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

    ws.send(JSON.stringify({ type: "streaming", status: "started" }));

    try {
      openClaude.sendInput(message.prompt);

      await waitForProcessComplete(openClaude, ws);
    } catch (err) {
      ws.send(JSON.stringify({
        type: "error",
        message: err.message,
      }));
    }
  }

  async function waitForProcessComplete(manager, ws) {
    return new Promise((resolve, reject) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          manager.kill();
          reject(new Error("Timed out waiting for response"));
        }
      }, 300000);

      const onExit = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        const messages = manager.parseBufferedOutput();
        for (const msg of messages) {
          ws.send(JSON.stringify(msg));
        }
        ws.send(JSON.stringify({ type: "streaming", status: "complete" }));
        resolve();
      };

      if (manager.process) {
        manager.process.once("exit", onExit);
        manager.process.once("error", (err) => {
          if (!settled) {
            settled = true;
            clearTimeout(timeout);
            reject(err);
          }
        });
      } else {
        clearTimeout(timeout);
        reject(new Error("No process to wait for"));
      }
    });
  }

  async function handleApplyPatch(ws, message) {
    const result = patchManager.apply(message.patch);
    ws.send(JSON.stringify({
      type: "patch_applied",
      success: result.success,
      filePath: result.filePath,
      error: result.error,
    }));
  }

  async function handleRejectPatch(ws, message) {
    patchManager.reject(message.patchId);
    ws.send(JSON.stringify({
      type: "patch_rejected",
      patchId: message.patchId,
    }));
  }

  async function handleCancel(ws) {
    openClaude.kill();
    ws.send(JSON.stringify({ type: "cancelled" }));
  }

  return { handleMessage };
}

module.exports = { createMessageRouter };
