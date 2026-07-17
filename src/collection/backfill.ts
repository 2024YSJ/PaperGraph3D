import type { Subscription } from '../models/subscription';
import { subscriptionKey } from '../models/subscription';
import { computeBackfillWindow } from './scheduler';

// Backfill runner (US5, FR-033–040): one pass over computeBackfillWindow(subscription)
// (oldest-first) through the SAME runCheck forward collection uses — only the window
// differs (FR-034). Never reads or writes lastCheckedAt (FR-035). See
// contracts/collection-pipeline.md § backfill.ts.

const MAX_NOPROGRESS_PASSES = 3; // FR-042 bounded no-progress escape (same constant as forward)

// Per-subscription no-progress counter, separate from the scheduler's forward map so a
// forward check and a backfill pass truncating for unrelated reasons don't affect each
// other's escape threshold (keyed by `${type}:${value}`).
const backfillNoProgress = new Map<string, number>();

export interface BackfillRunnerDeps {
	runCheck: (
		subscription: Subscription,
		window: { from: number; to: number },
	) => Promise<{ truncated: boolean; coveredThrough: number }>;
	onBackfillProgress: (subscription: Subscription, cursor: number) => Promise<void>;
	onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void;
}

// Runs ONE pass. Returns true when the caller's completion loop should continue (a pass
// ran and more may remain), false when it should stop (nothing to do, or a failure to
// retry later). The caller (scheduler) wraps this in the shared in-flight guard (FR-039).
export async function runBackfillPass(
	subscription: Subscription,
	deps: BackfillRunnerDeps,
): Promise<boolean> {
	if (!subscription.enabled) {
		return false;
	}
	const window = computeBackfillWindow(subscription);
	if (window === undefined || window.from >= window.to) {
		return false;
	}
	const key = subscriptionKey(subscription);

	let result: { truncated: boolean; coveredThrough: number };
	try {
		result = await deps.runCheck(subscription, window);
	} catch {
		// Leave the cursor unadvanced; surface once, retry on a later tick/load (FR-040).
		deps.onFailure?.(subscription, 'unreachable');
		return false;
	}

	const { truncated, coveredThrough } = result;

	if (!truncated) {
		backfillNoProgress.set(key, 0);
		await deps.onBackfillProgress(subscription, coveredThrough);
		return true;
	}

	// Truncated (FR-014) — advance over the covered prefix and signal "more next pass".
	if (coveredThrough <= window.from) {
		// No forward progress — structurally-unreadable span. Bounded escape (FR-042).
		const count = (backfillNoProgress.get(key) ?? 0) + 1;
		if (count >= MAX_NOPROGRESS_PASSES) {
			backfillNoProgress.set(key, 0);
			await deps.onBackfillProgress(subscription, window.to);
			deps.onFailure?.(subscription, 'truncated');
			return true;
		}
		backfillNoProgress.set(key, count);
		await deps.onBackfillProgress(subscription, coveredThrough);
		deps.onFailure?.(subscription, 'truncated');
		return true;
	}

	backfillNoProgress.set(key, 0);
	await deps.onBackfillProgress(subscription, coveredThrough);
	deps.onFailure?.(subscription, 'truncated');
	return true;
}
