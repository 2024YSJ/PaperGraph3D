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
		typeof candidate.enabled === 'boolean'
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
