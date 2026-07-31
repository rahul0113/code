/**
 * cliParser.js - Parses OpenClaude CLI output into structured data.
 *
 * The OpenClaude CLI outputs markdown/text with embedded tool calls.
 * This parser extracts:
 * - Text responses (markdown)
 * - Tool calls (read_file, write_file, etc.)
 * - File patches (unified diff format)
 * - Errors and warnings
 *
 * Output format (JSON lines to WebSocket):
 *   { type: "text", content: "..." }
 *   { type: "tool_call", name: "...", input: {...}, id: "..." }
 *   { type: "patch", filePath: "...", old: "...", new: "..." }
 *   { type: "error", message: "..." }
 *   { type: "done" }
 */

const fs = require("fs");

/**
 * Detect if a line starts a tool call block.
 * OpenClaude formats tool calls as:
 *   <tool_use>
 *     <name>tool_name</name>
 *     <input>{json}</input>
 *   </tool_use>
 */
const TOOL_CALL_START = /<tool_use>/;
const TOOL_CALL_END = /<\/tool_use>/;
const TOOL_NAME = /<name>(.*?)<\/name>/;
const TOOL_INPUT = /<input>([^]*?)<\/input>/;

/**
 * Detect unified diff patches in code blocks.
 * Format:
 *   ```diff
 *   --- a/file/path
 *   +++ b/file/path
 *   @@ ... @@
 *   -old
 *   +new
 *   ```
 */
const DIFF_BLOCK_START = /^```diff$/;
const DIFF_BLOCK_END = /^```$/;
const DIFF_HEADER_FILE = /^--- a\/(.+)$/;
const DIFF_NEW_FILE = /^\+\+\+ b\/(.+)$/;

/**
 * Detect inline file write blocks.
 * Format:
 *   [write_file: /path/to/file]
 *   <content>...</content>
 */
const WRITE_FILE_PATTERN = /\[write_file:\s*(.+?)\]/;
const READ_FILE_PATTERN = /\[read_file:\s*(.+?)\]/;
const CONTENT_START = /<content>/;
const CONTENT_END = /<\/content>/;

/**
 * Parse OpenClaude CLI output into structured messages.
 *
 * @param {string} output - Raw CLI output text
 * @returns {Array<object>} Array of parsed message objects
 */
function parseCliOutput(output) {
  if (!output) return [];
  const messages = [];
  const lines = output.split("\n");

  let inToolCall = false;
  let toolName = "";
  let toolInput = "";
  let inDiff = false;
  let currentDiffFile = "";
  let diffLines = [];
  let inContent = false;
  let contentFile = "";
  let contentLines = [];
  let textBuffer = [];

  function flushText() {
    const text = textBuffer.join("\n").trim();
    if (text) {
      messages.push({ type: "text", content: text });
    }
    textBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // --- Tool call blocks ---
    if (TOOL_CALL_START.test(line)) {
      flushText();
      inToolCall = true;
      toolName = "";
      toolInput = "";
      continue;
    }

    if (inToolCall) {
      const nameMatch = line.match(TOOL_NAME);
      if (nameMatch) {
        toolName = nameMatch[1];
        continue;
      }

      // Handle <content>...</content> inside a tool call
      if (CONTENT_START.test(line)) {
        inContent = true;
        contentLines = [];
        // Capture text after <content> on the same line
        const afterTag = line.replace(/.*<content>/, "");
        if (afterTag) contentLines.push(afterTag);
        continue;
      }

      if (CONTENT_END.test(line) && inContent) {
        inContent = false;
        // Merge content into toolInput for write_file
        const content = contentLines.join("\n");
        try {
          const parsed = toolInput ? JSON.parse(toolInput) : {};
          parsed.content = content;
          toolInput = JSON.stringify(parsed);
        } catch {
          toolInput = JSON.stringify({ content });
        }
        continue;
      }

      if (inContent) {
        contentLines.push(line);
        continue;
      }

      // Extract <input>...</input> content from a single line
      const inputMatch = line.match(TOOL_INPUT);
      if (inputMatch) {
        toolInput = inputMatch[1];
        continue;
      }

      // Handle partial <input> tag (start of multi-line input)
      if (line.includes("<input>") && !line.includes("</input>")) {
        toolInput = line.replace(/.*<input>/, "");
        continue;
      }

      if (TOOL_CALL_END.test(line)) {
        inToolCall = false;
        let input = {};
        try {
          input = toolInput ? JSON.parse(toolInput) : {};
        } catch {
          input = { raw: toolInput };
        }

        if (toolName) {
          messages.push({
            type: "tool_call",
            name: toolName,
            input,
            id: `tool_${messages.length}_${Date.now()}`,
          });
        }
        continue;
      }

      // Accumulate input JSON (for multi-line inputs)
      if (toolName) {
        toolInput += line;
      }
      continue;
    }

    // --- Diff blocks ---
    if (DIFF_BLOCK_START.test(line)) {
      flushText();
      inDiff = true;
      currentDiffFile = "";
      diffLines = [];
      continue;
    }

    if (inDiff) {
      if (DIFF_BLOCK_END.test(line)) {
        inDiff = false;
        if (currentDiffFile && diffLines.length > 0) {
          const { oldContent, newContent } = parseDiffContent(diffLines);
          messages.push({
            type: "patch",
            filePath: currentDiffFile,
            old: oldContent,
            new: newContent,
          });
        }
        continue;
      }

      const fileMatch = line.match(DIFF_HEADER_FILE);
      if (fileMatch) {
        currentDiffFile = fileMatch[1];
        continue;
      }

      const newFileMatch = line.match(DIFF_NEW_FILE);
      if (newFileMatch) {
        currentDiffFile = currentDiffFile || newFileMatch[1];
        continue;
      }

      diffLines.push(line);
      continue;
    }

    // --- Inline write_file blocks ---
    const writeMatch = line.match(WRITE_FILE_PATTERN);
    if (writeMatch) {
      flushText();
      contentFile = writeMatch[1];
      inContent = true;
      contentLines = [];
      continue;
    }

    // --- Inline read_file blocks ---
    const readMatch = line.match(READ_FILE_PATTERN);
    if (readMatch) {
      flushText();
      messages.push({
        type: "tool_call",
        name: "read_file",
        input: { path: readMatch[1] },
        id: `tool_${messages.length}_${Date.now()}`,
      });
      continue;
    }

    // --- Content blocks (outside tool calls) ---
    if (inContent) {
      if (CONTENT_END.test(line)) {
        inContent = false;
        if (contentFile) {
          messages.push({
            type: "patch",
            filePath: contentFile,
            old: null,
            new: contentLines.join("\n"),
          });
          contentFile = "";
        }
        continue;
      }
      contentLines.push(line);
      continue;
    }

    // --- Regular text ---
    textBuffer.push(line);
  }

  flushText();

  if (messages.length === 0 && output.trim()) {
    messages.push({ type: "text", content: output.trim() });
  }

  return messages;
}

/**
 * Parse diff content lines into old/new content.
 * @param {string[]} lines - Diff lines (without +++ / --- headers)
 * @returns {{ oldContent: string, newContent: string }}
 */
function parseDiffContent(lines) {
  const oldLines = [];
  const newLines = [];

  for (const line of lines) {
    if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
    // @@ context markers are skipped
  }

  return {
    oldContent: oldLines.join("\n"),
    newContent: newLines.join("\n"),
  };
}

/**
 * Create a streaming parser that processes CLI output line by line.
 * Useful for real-time WebSocket streaming.
 *
 * @returns {{ feedLine: (line: string) => void, flush: () => object[], reset: () => void }}
 */
function createStreamingParser() {
  const parser = {
    _buffer: [],
    _inBlock: false,
    _blockType: null,

    feedLine(line) {
      this._buffer.push(line);
    },

    flush() {
      const output = this._buffer.join("\n");
      this._buffer = [];
      return parseCliOutput(output);
    },

    reset() {
      this._buffer = [];
      this._inBlock = false;
      this._blockType = null;
    },
  };

  return parser;
}

module.exports = {
  parseCliOutput,
  parseDiffContent,
  createStreamingParser,
};
