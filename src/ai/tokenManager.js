/**
 * tokenManager.js - Tracks API token usage and warns on approaching limits.
 *
 * Maintains a rolling window of usage data, calculates cost estimates,
 * and provides warnings when approaching configured limits.
 */

const DEFAULT_LIMITS = {
	dailyTokens: 1000000, // 1M tokens per day
	monthlyTokens: 20000000, // 20M tokens per month
	dailyCostUsd: 10.0, // $10/day
	monthlyCostUsd: 100.0, // $100/month
};

// Approximate costs per 1M tokens by model family
const MODEL_COSTS = {
	"claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
	"claude-haiku": { input: 0.25, output: 1.25 },
	"claude-opus": { input: 15.0, output: 75.0 },
};

class TokenManager {
	constructor(limits = {}) {
		this.limits = { ...DEFAULT_LIMITS, ...limits };
		/** @type {Array<{timestamp: number, inputTokens: number, outputTokens: number, costUsd: number, model: string}>} */
		this._usageLog = [];
	}

	/**
	 * Record a completed request's token usage.
	 * @param {object} usage
	 * @param {number} usage.inputTokens
	 * @param {number} usage.outputTokens
	 * @param {number} [usage.costUsd]
	 * @param {string} [usage.model]
	 */
	record(usage) {
		this._usageLog.push({
			timestamp: Date.now(),
			inputTokens: usage.inputTokens || 0,
			outputTokens: usage.outputTokens || 0,
			costUsd: usage.costUsd || this._estimateCost(usage),
			model: usage.model || "unknown",
		});

		// Prune entries older than 30 days
		const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
		while (this._usageLog.length > 0 && this._usageLog[0].timestamp < cutoff) {
			this._usageLog.shift();
		}
	}

	/**
	 * Get current usage totals for the given period.
	 * @param {"day"|"month"} period
	 * @returns {{tokens: number, costUsd: number, requests: number}}
	 */
	getUsage(period = "day") {
		const now = Date.now();
		const windowMs =
			period === "day" ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
		const cutoff = now - windowMs;

		let tokens = 0;
		let costUsd = 0;
		let requests = 0;

		for (const entry of this._usageLog) {
			if (entry.timestamp >= cutoff) {
				tokens += entry.inputTokens + entry.outputTokens;
				costUsd += entry.costUsd;
				requests++;
			}
		}

		return { tokens, costUsd, requests };
	}

	/**
	 * Check if a new request would exceed limits.
	 * @param {object} estimatedUsage - {inputTokens, outputTokens}
	 * @returns {{ok: boolean, warnings: string[]}}
	 */
	checkLimits(estimatedUsage = {}) {
		const warnings = [];
		const estimatedTokens =
			(estimatedUsage.inputTokens || 0) + (estimatedUsage.outputTokens || 0);
		const estimatedCost = this._estimateCost(estimatedUsage);

		const daily = this.getUsage("day");
		const monthly = this.getUsage("month");

		if (daily.tokens + estimatedTokens > this.limits.dailyTokens) {
			warnings.push(
				`Daily token limit approaching (${Math.round((daily.tokens / this.limits.dailyTokens) * 100)}% used)`,
			);
		}
		if (monthly.tokens + estimatedTokens > this.limits.monthlyTokens) {
			warnings.push(
				`Monthly token limit approaching (${Math.round((monthly.tokens / this.limits.monthlyTokens) * 100)}% used)`,
			);
		}
		if (daily.costUsd + estimatedCost > this.limits.dailyCostUsd) {
			warnings.push(
				`Daily cost limit approaching ($${(daily.costUsd + estimatedCost).toFixed(2)}/${this.limits.dailyCostUsd})`,
			);
		}
		if (monthly.costUsd + estimatedCost > this.limits.monthlyCostUsd) {
			warnings.push(
				`Monthly cost limit approaching ($${(monthly.costUsd + estimatedCost).toFixed(2)}/${this.limits.monthlyCostUsd})`,
			);
		}

		return { ok: warnings.length === 0, warnings };
	}

	/**
	 * Get a summary for display.
	 * @returns {object}
	 */
	getSummary() {
		const daily = this.getUsage("day");
		const monthly = this.getUsage("month");

		return {
			daily: {
				tokens: daily.tokens,
				costUsd: daily.costUsd.toFixed(2),
				requests: daily.requests,
				tokenLimit: this.limits.dailyTokens,
				costLimit: this.limits.dailyCostUsd,
			},
			monthly: {
				tokens: monthly.tokens,
				costUsd: monthly.costUsd.toFixed(2),
				requests: monthly.requests,
				tokenLimit: this.limits.monthlyTokens,
				costLimit: this.limits.monthlyCostUsd,
			},
		};
	}

	/**
	 * Reset usage data.
	 */
	reset() {
		this._usageLog = [];
	}

	/**
	 * Estimate cost from token counts using model pricing.
	 * @private
	 */
	_estimateCost(usage) {
		const pricing =
			MODEL_COSTS[usage.model] || MODEL_COSTS["claude-sonnet-4-20250514"];
		const input = ((usage.inputTokens || 0) / 1_000_000) * pricing.input;
		const output = ((usage.outputTokens || 0) / 1_000_000) * pricing.output;
		return input + output;
	}
}

module.exports = { TokenManager };
