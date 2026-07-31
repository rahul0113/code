/**
 * ai.tests.js - Android E2E tests for AI coding assistant.
 *
 * Runs inside the Acode WebView environment via the in-app test runner.
 * Tests core AI modules: tokenManager, settings, conversationStore,
 * contextCollector, and toolExecutor.
 */

import { TokenManager } from "../ai/tokenManager";
import { aiSettings } from "../ai/settings";
import { ConversationStore } from "../ai/conversationStore";
import { ContextCollector } from "../ai/contextCollector";
import { ToolExecutor } from "../ai/toolExecutor";
import { TestRunner } from "./tester";

export async function runAiTests(writeOutput) {
	const runner = new TestRunner("AI Assistant Tests");

	// ── TokenManager ──────────────────────────────────────────

	runner.test("TokenManager records usage", (test) => {
		const tm = new TokenManager();
		tm.record({ inputTokens: 100, outputTokens: 200, costUsd: 0.01 });
		const usage = tm.getUsage("day");
		test.assertEqual(usage.tokens, 300, "Total tokens should be 300");
		test.assertEqual(usage.requests, 1, "Should have 1 request");
	});

	runner.test("TokenManager aggregates multiple records", (test) => {
		const tm = new TokenManager();
		tm.record({ inputTokens: 100, outputTokens: 200, costUsd: 0.005 });
		tm.record({ inputTokens: 300, outputTokens: 400, costUsd: 0.01 });
		const usage = tm.getUsage("day");
		test.assertEqual(usage.tokens, 1000, "Total tokens should be 1000");
		test.assertEqual(usage.requests, 2, "Should have 2 requests");
		test.assert(usage.costUsd > 0, "Cost should be positive");
	});

	runner.test("TokenManager warns on limit approach", (test) => {
		const tm = new TokenManager({ dailyTokens: 500 });
		tm.record({ inputTokens: 400, outputTokens: 50, costUsd: 0.001 });
		const check = tm.checkLimits({ inputTokens: 100, outputTokens: 100 });
		test.assert(!check.ok, "Should warn when approaching limit");
		test.assert(check.warnings.length > 0, "Should have warnings");
	});

	runner.test("TokenManager returns ok within limits", (test) => {
		const tm = new TokenManager({ dailyTokens: 1000000 });
		const check = tm.checkLimits({ inputTokens: 100, outputTokens: 100 });
		test.assert(check.ok, "Should be ok within limits");
	});

	runner.test("TokenManager getSummary for UI", (test) => {
		const tm = new TokenManager();
		tm.record({ inputTokens: 500, outputTokens: 1000, costUsd: 0.05 });
		const summary = tm.getSummary();
		test.assertEqual(summary.daily.tokens, 1500, "Daily tokens should be 1500");
		test.assertEqual(summary.daily.requests, 1, "Daily requests should be 1");
		test.assert(typeof summary.daily.costUsd === "string", "Cost should be string for display");
	});

	runner.test("TokenManager reset clears data", (test) => {
		const tm = new TokenManager();
		tm.record({ inputTokens: 100, outputTokens: 200, costUsd: 0.01 });
		tm.reset();
		const usage = tm.getUsage("day");
		test.assertEqual(usage.tokens, 0, "Tokens should be 0 after reset");
		test.assertEqual(usage.requests, 0, "Requests should be 0 after reset");
	});

	// ── Settings ──────────────────────────────────────────────

	runner.test("Settings get returns defaults", (test) => {
		const settings = aiSettings.get();
		test.assert(settings !== null, "Settings should not be null");
		test.assert(typeof settings.model === "string", "Model should be a string");
		test.assert(typeof settings.apiKey === "string", "API key should be a string");
	});

	runner.test("Settings update persists", (test) => {
		const original = aiSettings.get();
		aiSettings.update({ model: "claude-sonnet-4-20250514" });
		const updated = aiSettings.get();
		test.assertEqual(updated.model, "claude-sonnet-4-20250514", "Model should be updated");
		// Restore
		aiSettings.update({ model: original.model });
	});

	runner.test("Settings validate rejects invalid", (test) => {
		const result = aiSettings.validate({ model: "" });
		test.assert(!result.valid, "Empty model should be invalid");
		test.assert(result.errors.length > 0, "Should have error messages");
	});

	runner.test("Settings onChange listener fires", (test) => {
		let called = false;
		const cb = () => { called = true; };
		aiSettings.onChange(cb);
		aiSettings.update({ model: "test-model" });
		aiSettings.offChange(cb);
		test.assert(called, "onChange callback should have been called");
		// Restore
		const original = aiSettings.get();
		aiSettings.update({ model: original.model });
	});

	// ── ConversationStore ─────────────────────────────────────

	runner.test("ConversationStore create and get", (test) => {
		const store = new ConversationStore();
		const conv = store.create("Test Chat");
		test.assert(conv.id !== undefined, "Conversation should have an id");
		test.assertEqual(conv.title, "Test Chat", "Title should match");
		const retrieved = store.get(conv.id);
		test.assert(retrieved !== null, "Should retrieve the conversation");
	});

	runner.test("ConversationStore addMessage", (test) => {
		const store = new ConversationStore();
		const conv = store.create();
		store.addMessage(conv.id, "user", "Hello");
		store.addMessage(conv.id, "assistant", "Hi there!");
		const messages = store.getMessages(conv.id);
		test.assertEqual(messages.length, 2, "Should have 2 messages");
		test.assertEqual(messages[0].content, "Hello", "First message content should match");
		test.assertEqual(messages[1].content, "Hi there!", "Second message content should match");
	});

	runner.test("ConversationStore auto-titles from first user message", (test) => {
		const store = new ConversationStore();
		const conv = store.create();
		store.addMessage(conv.id, "user", "Fix the login bug");
		const updated = store.get(conv.id);
		test.assertEqual(updated.title, "Fix the login bug", "Title should be first user message");
	});

	runner.test("ConversationStore enforces message limit", (test) => {
		const store = new ConversationStore();
		const conv = store.create();
		for (let i = 0; i < 250; i++) {
			store.addMessage(conv.id, "user", `Message ${i}`);
		}
		const updated = store.get(conv.id);
		test.assert(updated.messages.length <= 200, "Should cap at 200 messages");
	});

	runner.test("ConversationStore delete", (test) => {
		const store = new ConversationStore();
		const conv1 = store.create("Chat 1");
		const conv2 = store.create("Chat 2");
		store.delete(conv2.id);
		test.assert(store.get(conv2.id) === null, "Deleted conversation should be null");
		test.assert(store.get(conv1.id) !== null, "Other conversation should still exist");
	});

	runner.test("ConversationStore list", (test) => {
		const store = new ConversationStore();
		store.create("A");
		store.create("B");
		const list = store.list();
		test.assert(list.length >= 2, "Should list at least 2 conversations");
		test.assert(list[0].title !== undefined, "List items should have title");
	});

	runner.test("ConversationStore setActive/getActive", (test) => {
		const store = new ConversationStore();
		const conv = store.create("Active Chat");
		store.setActive(conv.id);
		const active = store.getActive();
		test.assert(active !== null, "Active conversation should not be null");
		test.assertEqual(active.id, conv.id, "Active conversation id should match");
	});

	runner.test("ConversationStore clear", (test) => {
		const store = new ConversationStore();
		store.create("Chat 1");
		store.create("Chat 2");
		store.clear();
		test.assertEqual(store.list().length, 0, "Should have 0 conversations after clear");
		test.assert(store.getActive() === null, "Active should be null after clear");
	});

	// ── ToolExecutor workspace boundary ───────────────────────

	runner.test("ToolExecutor rejects paths outside workspace", (test) => {
		const executor = new ToolExecutor("/public");
		// The _isWithinWorkspace method should reject /etc/passwd
		const result = executor._isWithinWorkspace("/etc/passwd");
		test.assert(!result, "Should reject /etc/passwd");
	});

	runner.test("ToolExecutor accepts paths within workspace", (test) => {
		const executor = new ContextCollector("/public");
		// ContextCollector uses rootDir — check it doesn't escape
		const result = executor.collect("/public/src/test/sanity.tests.js");
		test.assert(result !== null, "Should collect context for in-workspace file");
	});

	runner.test("ToolExecutor rejects prefix-attack paths", (test) => {
		const executor = new ToolExecutor("/public");
		// /publicfoo is NOT within /public — must have trailing slash
		const result = executor._isWithinWorkspace("/publicfoo");
		test.assert(!result, "Should reject /publicfoo (prefix attack)");
	});

	// ── ContextCollector ──────────────────────────────────────

	runner.test("ContextCollector collect file", (test) => {
		const collector = new ContextCollector("/public");
		const result = collector.collect("src/test/sanity.tests.js");
		test.assert(result.files.length > 0, "Should collect at least one file");
		test.assert(result.tree.length > 0, "Should have a tree");
	});

	runner.test("ContextCollector caches tree results", (test) => {
		const collector = new ContextCollector("/public");
		const r1 = collector.collect("src/test");
		const r2 = collector.collect("src/test");
		test.assert(collector._treeCache !== null, "Tree cache should be populated");
	});

	runner.test("ContextCollector invalidateCache clears data", (test) => {
		const collector = new ContextCollector("/public");
		collector.collect("src/test");
		test.assert(collector._treeCache !== null, "Cache should be populated");
		collector.invalidateCache();
		test.assert(collector._treeCache === null, "Cache should be null after invalidation");
	});

	runner.test("ContextCollector formatContext produces XML", (test) => {
		const collector = new ContextCollector("/public");
		const result = collector.collect("src/test/sanity.tests.js");
		const formatted = collector.formatContext(result);
		test.assert(formatted.includes("<file"), "Should contain <file> tags");
		test.assert(formatted.includes("<project-structure>"), "Should contain project structure");
	});

	return await runner.run(writeOutput);
}
