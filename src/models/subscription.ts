// Single source of truth for the allowed subscription types and check intervals:
// the union types below are derived from these arrays, so a later feature adding
// a type or interval (FR-016) extends both the compile-time union and the runtime
// validators (isValidSubscription/assignCheckInterval) with one edit — no drift.
const SUBSCRIPTION_TYPES = ['keyword', 'author', 'arxivCategory'] as const;

export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

export const ALLOWED_CHECK_INTERVALS_HOURS = [6, 12, 24, 48, 72] as const;

export type CheckIntervalHours = (typeof ALLOWED_CHECK_INTERVALS_HOURS)[number];

export const DEFAULT_CHECK_INTERVAL_HOURS: CheckIntervalHours = 24;

export interface Subscription {
	type: SubscriptionType;
	value: string;
	label: string;
	checkIntervalHours: CheckIntervalHours;
	lastCheckedAt: number | null;
	enabled: boolean;
	// Backward floor: the oldest instant (epoch ms) this subscription's collection has
	// covered. First recorded atomically by the store's recordChecked on a subscription's
	// first successful check (as that check's window.from = registration − 24h); lowered by
	// a completed backfill. Absent/null on a subscription that has never successfully
	// checked. Load-bearing for forward collection's FR-041 announcement-lag clamp,
	// independent of whether backfill is ever used. FR-016-style additive 002 extension.
	coveredFrom?: number | null;
	// Present only while a historical backfill (US5, FR-033–040) is active: cursor starts
	// at targetFrom and advances upward toward coveredFrom (both epoch ms). Absent/null when
	// no backfill is in progress. FR-016-style additive 002 extension; nothing outside US5
	// reads or writes it.
	backfillState?: { targetFrom: number; cursor: number } | null;
}

function isCheckIntervalHours(value: unknown): value is CheckIntervalHours {
	return typeof value === 'number' && (ALLOWED_CHECK_INTERVALS_HOURS as readonly number[]).includes(value);
}

export function isValidSubscription(data: unknown): data is Subscription {
	if (typeof data !== 'object' || data === null) {
		return false;
	}

	const candidate = data as Record<string, unknown>;

	return (
		typeof candidate.type === 'string' &&
		(SUBSCRIPTION_TYPES as readonly string[]).includes(candidate.type) &&
		typeof candidate.value === 'string' &&
		typeof candidate.label === 'string' &&
		isCheckIntervalHours(candidate.checkIntervalHours) &&
		(candidate.lastCheckedAt === null || typeof candidate.lastCheckedAt === 'number') &&
		typeof candidate.enabled === 'boolean' &&
		isValidCoveredFrom(candidate.coveredFrom) &&
		isValidBackfillState(candidate.backfillState)
	);
}

// Optional 002 extensions (FR-041 / FR-033–040): a subscription without either field
// still validates (both absent by default). When present, coveredFrom must be a finite
// number or null; backfillState must be null or an object with finite targetFrom/cursor.
function isValidCoveredFrom(value: unknown): boolean {
	return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isValidBackfillState(value: unknown): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (typeof value !== 'object') {
		return false;
	}
	const state = value as Record<string, unknown>;
	return (
		typeof state.targetFrom === 'number' &&
		Number.isFinite(state.targetFrom) &&
		typeof state.cursor === 'number' &&
		Number.isFinite(state.cursor)
	);
}

// Enforces FR-005: a requested interval outside the five allowed values is
// rejected, leaving the subscription's prior valid interval (`current`) unchanged
// rather than throwing — so callers can pass raw UI/JSON input straight through.
export function assignCheckInterval(
	current: CheckIntervalHours,
	requested: number,
): CheckIntervalHours {
	return isCheckIntervalHours(requested) ? requested : current;
}
