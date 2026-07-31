/**
 * diffViewer.js - Renders unified diffs as DOM elements.
 *
 * Parses unified diff format and creates a styled DOM tree
 * with line-level coloring for additions, deletions, and context.
 */

const LINE_TYPES = {
	CONTEXT: "context",
	ADD: "add",
	REMOVE: "remove",
	HEADER: "header",
};

/**
 * Parse a unified diff string into structured line objects.
 * @param {string} diff - Unified diff text
 * @returns {{ lines: Array<{type: string, content: string, oldLine: number|null, newLine: number|null}>, stats: {added: number, removed: number, unchanged: number} }}
 */
function parseDiff(diff) {
	const rawLines = diff.split("\n");
	const lines = [];
	let oldLine = 0;
	let newLine = 0;
	let stats = { added: 0, removed: 0, unchanged: 0 };

	for (const raw of rawLines) {
		// File headers
		if (
			raw.startsWith("--- ") ||
			raw.startsWith("+++ ") ||
			raw.startsWith("@@")
		) {
			if (raw.startsWith("@@")) {
				const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
				if (match) {
					oldLine = Number.parseInt(match[1], 10);
					newLine = Number.parseInt(match[2], 10);
				}
				lines.push({
					type: LINE_TYPES.HEADER,
					content: raw,
					oldLine: null,
					newLine: null,
				});
			} else {
				lines.push({
					type: LINE_TYPES.HEADER,
					content: raw,
					oldLine: null,
					newLine: null,
				});
			}
			continue;
		}

		// Context line
		if (raw.startsWith(" ")) {
			lines.push({
				type: LINE_TYPES.CONTEXT,
				content: raw.substring(1),
				oldLine,
				newLine,
			});
			oldLine++;
			newLine++;
			stats.unchanged++;
		} else if (raw.startsWith("-")) {
			lines.push({
				type: LINE_TYPES.REMOVE,
				content: raw.substring(1),
				oldLine,
				newLine: null,
			});
			oldLine++;
			stats.removed++;
		} else if (raw.startsWith("+")) {
			lines.push({
				type: LINE_TYPES.ADD,
				content: raw.substring(1),
				oldLine: null,
				newLine,
			});
			newLine++;
			stats.added++;
		} else if (raw.length > 0) {
			// Treat as context
			lines.push({
				type: LINE_TYPES.CONTEXT,
				content: raw,
				oldLine: null,
				newLine: null,
			});
		}
	}

	return { lines, stats };
}

/**
 * Create a DOM element for a single diff line.
 * @param {{ type: string, content: string, oldLine: number|null, newLine: number|null }} line
 * @returns {HTMLElement}
 */
function createLineElement(line) {
	const el = document.createElement("div");
	el.className = `ai-diff__line ai-diff__line--${line.type}`;

	const gutter = document.createElement("span");
	gutter.className = "ai-diff__gutter";
	gutter.textContent = line.oldLine !== null ? String(line.oldLine) : "";
	if (line.newLine !== null) {
		gutter.dataset.newLine = line.newLine;
	}

	const prefix = document.createElement("span");
	prefix.className = "ai-diff__prefix";
	if (line.type === LINE_TYPES.ADD) prefix.textContent = "+";
	else if (line.type === LINE_TYPES.REMOVE) prefix.textContent = "-";
	else if (line.type === LINE_TYPES.HEADER) prefix.textContent = "";
	else prefix.textContent = " ";

	const content = document.createElement("span");
	content.className = "ai-diff__content";
	content.textContent = line.content;

	el.appendChild(gutter);
	el.appendChild(prefix);
	el.appendChild(content);

	return el;
}

/**
 * Create a diff viewer DOM element from a unified diff string.
 * @param {string} diff - Unified diff text
 * @param {HTMLElement} [container] - Optional container to append to
 * @returns {{ element: HTMLElement, stats: {added: number, removed: number, unchanged: number} }}
 */
function createDiffViewer(diff, container) {
	const { lines, stats } = parseDiff(diff);

	const wrapper = document.createElement("div");
	wrapper.className = "ai-diff";

	// Stats bar
	const statsBar = document.createElement("div");
	statsBar.className = "ai-diff__stats";
	statsBar.innerHTML =
		`<span class="ai-diff__stat ai-diff__stat--add">+${stats.added}</span>` +
		`<span class="ai-diff__stat ai-diff__stat--remove">-${stats.removed}</span>` +
		`<span class="ai-diff__stat ai-diff__stat--context">${stats.unchanged} unchanged</span>`;
	wrapper.appendChild(statsBar);

	// Diff lines
	const linesContainer = document.createElement("div");
	linesContainer.className = "ai-diff__lines";

	for (const line of lines) {
		linesContainer.appendChild(createLineElement(line));
	}

	wrapper.appendChild(linesContainer);

	if (container) container.appendChild(wrapper);

	return { element: wrapper, stats };
}

export { createDiffViewer, createLineElement, LINE_TYPES, parseDiff };
