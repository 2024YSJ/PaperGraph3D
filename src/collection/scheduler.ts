import type { Plugin } from 'obsidian';
import type { Subscription } from '../models/subscription';
import { runBackfillPass } from './backfill';

// One 15-minute registerInterval-backed tick (research.md Decision 4) that checks each due
// subscription, plus a catch-up-on-load pass, an immediate checkNow on new registration,
// the FR-041 announcement-lag re-scan, and backfill resumption. Owns lastCheckedAt
// advancement. See contracts/collection-pipeline.md § scheduler.ts.

const SCHEDULER_TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const ANNOUNCEMENT_LAG_MS = 4 * 24 * 60 * 60 * 1000; // 4 days (FR-041, research.md Decision 38)
const MAX_NOPROGRESS_PASSES = 3; // FR-026 bounded no-progress escape
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface SchedulerDeps {
	getSubscriptions: () => Subscription[];
	onSubscriptionChecked: (
		subscription: Subscription,
		checkedThrough: number,
		windowFrom: number,
	) => Promise<void>;
	runCheck: (
		subscription: Subscription,
		window: { from: number; to: number },
	) => Promise<{ truncated: boolean; coveredThrough: number }>;
	onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void;
	onBackfillProgress?: (subscription: Subscription, cursor: number) => Promise<void>;
	now?: () => number;
}

export interface SchedulerHandle {
	checkNow(subscription: Subscription): Promise<void>;
	backfillNow(subscription: Subscription): Promise<void>;
}

function keyOf(subscription: { type: string; value: string }): string {
	return `${subscription.type}:${subscription.value}`;
}

// FRONTIER window (drives lastCheckedAt). Two cases (FR-024, FR-030).
export function computeCollectionWindow(
	subscription: Pick<Subscription, 'lastCheckedAt'>,
	now: number,
): { from: number; to: number } {
	const { lastCheckedAt } = subscription;
	if (lastCheckedAt !== null && lastCheckedAt !== undefined && lastCheckedAt > now) {
		// Clock backward — an empty window (FR-024).
		return { from: now, to: now };
	}
	const from = lastCheckedAt ?? now - DAY_MS; // FR-030 24h bound on a first check.
	return { from: Math.min(from, now), to: now };
}

// The FR-041 announcement-lag re-scan — a SECOND, independent window, anchored to the
// already-computed frontier window's own `from` (research.md Decision 39), never fed into
// recordChecked. Undefined on a first check or clock-backward reading.
export function computeLagOverlapWindow(
	frontierWindow: { from: number; to: number },
	subscription: Pick<Subscription, 'lastCheckedAt' | 'coveredFrom'>,
	now: number,
): { from: number; to: number } | undefined {
	const { lastCheckedAt } = subscription;
	if (lastCheckedAt === null || lastCheckedAt === undefined || lastCheckedAt > now) {
		return undefined;
	}
	const floor = subscription.coveredFrom ?? Number.NEGATIVE_INFINITY;
	return {
		from: Math.max(frontierWindow.from - ANNOUNCEMENT_LAG_MS, floor),
		to: frontierWindow.from,
	};
}

// Backward-collection window: { from: cursor, to: coveredFrom } — or undefined when there
// is no active backfillState / no forward floor to fill below.
export function computeBackfillWindow(
	subscription: Pick<Subscription, 'coveredFrom' | 'backfillState'>,
): { from: number; to: number } | undefined {
	const state = subscription.backfillState;
	if (state === undefined || state === null) {
		return undefined;
	}
	const coveredFrom = subscription.coveredFrom;
	if (coveredFrom === undefined || coveredFrom === null) {
		return undefined;
	}
	return { from: state.cursor, to: coveredFrom };
}

function isDue(subscription: Subscription, now: number): boolean {
	if (!subscription.enabled) {
		return false;
	}
	const last = subscription.lastCheckedAt ?? Number.NEGATIVE_INFINITY;
	return now >= last + subscription.checkIntervalHours * HOUR_MS;
}

export async function startScheduler(
	plugin: Plugin,
	deps: SchedulerDeps,
): Promise<SchedulerHandle> {
	const nowFn = deps.now ?? (() => Date.now());
	const inFlight = new Set<string>();
	const failing = new Map<string, 'unreachable' | 'truncated'>();
	const noProgress = new Map<string, number>();

	function notifyFailure(
		key: string,
		subscription: Subscription,
		reason: 'unreachable' | 'truncated',
	): void {
		// Once-per-reason gating (FR-012a): notify only on a transition into this reason.
		if (failing.get(key) === reason) {
			return;
		}
		failing.set(key, reason);
		deps.onFailure?.(subscription, reason);
	}

	async function recordFrontierSuccess(
		key: string,
		subscription: Subscription,
		window: { from: number; to: number },
		result: { truncated: boolean; coveredThrough: number },
	): Promise<void> {
		const { truncated, coveredThrough } = result;
		if (!truncated) {
			failing.delete(key);
			noProgress.set(key, 0);
			await deps.onSubscriptionChecked(subscription, coveredThrough, window.from);
			return;
		}
		// Truncated — surface the FR-014 notice, but still advance over the covered prefix.
		if (coveredThrough <= window.from) {
			// No forward progress this pass (no readable submission time among fetched entries).
			const count = (noProgress.get(key) ?? 0) + 1;
			if (count >= MAX_NOPROGRESS_PASSES) {
				// Bounded escape: abandon the remainder of this window (notice-backed) so the
				// subscription can never re-fetch the same unreadable prefix forever (FR-026).
				noProgress.set(key, 0);
				await deps.onSubscriptionChecked(subscription, window.to, window.from);
				notifyFailure(key, subscription, 'truncated');
				return;
			}
			noProgress.set(key, count);
			await deps.onSubscriptionChecked(subscription, coveredThrough, window.from);
			notifyFailure(key, subscription, 'truncated');
			return;
		}
		noProgress.set(key, 0);
		await deps.onSubscriptionChecked(subscription, coveredThrough, window.from);
		notifyFailure(key, subscription, 'truncated');
	}

	// Runs one subscription through the frontier check + FR-041 lag re-scan under the
	// per-subscription in-flight guard. No-op when disabled or already in flight.
	async function runFrontier(subscription: Subscription): Promise<void> {
		if (!subscription.enabled) {
			return;
		}
		const key = keyOf(subscription);
		if (inFlight.has(key)) {
			return;
		}
		const now = nowFn();
		// Compute BOTH windows upfront, from this one pre-check snapshot (research.md
		// Decision 39) — the lag window's `to` must anchor to the frontier's own `from`,
		// never a value re-read after recordChecked may have advanced lastCheckedAt.
		const window = computeCollectionWindow(subscription, now);
		const lagWindow = computeLagOverlapWindow(window, subscription, now);

		inFlight.add(key);
		try {
			let result: { truncated: boolean; coveredThrough: number };
			try {
				result = await deps.runCheck(subscription, window);
			} catch {
				notifyFailure(key, subscription, 'unreachable');
				return;
			}
			await recordFrontierSuccess(key, subscription, window, result);

			// FR-041 lag re-scan: a second query over the already-computed lag window, result
			// entirely discarded (no recordChecked, no notice, rejection swallowed).
			if (lagWindow !== undefined && lagWindow.from < lagWindow.to) {
				try {
					await deps.runCheck(subscription, lagWindow);
				} catch {
					// best-effort — carries no persisted cursor, nothing to strand.
				}
			}
		} finally {
			inFlight.delete(key);
		}
	}

	function currentSubscription(subscription: Subscription): Subscription | undefined {
		const key = keyOf(subscription);
		return deps.getSubscriptions().find((candidate) => keyOf(candidate) === key);
	}

	// Drives a subscription's backfill to completion, one pass at a time, re-fetching fresh
	// state (advanced cursor) between passes. Each pass runs under the shared in-flight guard.
	async function runBackfillLoop(subscription: Subscription): Promise<void> {
		for (;;) {
			const current = currentSubscription(subscription);
			if (current === undefined || !current.enabled) {
				return;
			}
			if (computeBackfillWindow(current) === undefined) {
				return;
			}
			const key = keyOf(current);
			if (inFlight.has(key)) {
				return; // a forward check holds the guard; the tick safety-net re-arms later.
			}
			inFlight.add(key);
			let shouldContinue: boolean;
			try {
				shouldContinue = await runBackfillPass(current, {
					runCheck: deps.runCheck,
					onBackfillProgress: async (sub, cursor) => {
						await deps.onBackfillProgress?.(sub, cursor);
					},
					onFailure: (sub, reason) => notifyFailure(keyOf(sub), sub, reason),
				});
			} finally {
				inFlight.delete(key);
			}
			if (!shouldContinue) {
				return;
			}
			await new Promise((resolve) => window.setTimeout(resolve, 0));
		}
	}

	async function processSubscription(subscription: Subscription, now: number, dueOnly: boolean): Promise<void> {
		if (!subscription.enabled) {
			return;
		}
		if (!dueOnly || isDue(subscription, now)) {
			await runFrontier(subscription);
		}
		// Backfill safety net: re-arm any subscription with an active backfillState.
		if (subscription.backfillState !== undefined && subscription.backfillState !== null) {
			await runBackfillLoop(subscription);
		}
	}

	async function tick(): Promise<void> {
		const now = nowFn();
		for (const subscription of deps.getSubscriptions()) {
			await processSubscription(subscription, now, true);
		}
	}

	// Catch-up-on-load pass — synchronous part of startScheduler, no artificial delay
	// (research.md Decision 17). Every enabled subscription gets one frontier check.
	const catchUpNow = nowFn();
	for (const subscription of deps.getSubscriptions()) {
		await processSubscription(subscription, catchUpNow, false);
	}

	// Register the single recurring tick via registerInterval (constitution Principle II).
	const handle = window.setInterval(() => {
		void tick();
	}, SCHEDULER_TICK_INTERVAL_MS);
	(handle as unknown as { unref?: () => void }).unref?.();
	plugin.registerInterval?.(handle);

	return {
		checkNow: (subscription) => runFrontier(subscription),
		backfillNow: (subscription) => runBackfillLoop(subscription),
	};
}
