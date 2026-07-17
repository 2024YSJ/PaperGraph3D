// Single source of truth for the allowed subscription types and check intervals:
// the union types below are derived from these arrays, so a later feature adding
// a type or interval (FR-016) extends both the compile-time union and the runtime
// validators (isValidSubscription/assignCheckInterval) with one edit — no drift.
const SUBSCRIPTION_TYPES = ['keyword', 'author', 'arxivCategory'] as const;

export type SubscriptionType = (typeof SUBSCRIPTION_TYPES)[number];

export const ALLOWED_CHECK_INTERVALS_HOURS = [6, 12, 24, 48, 72] as const;

export type CheckIntervalHours = (typeof ALLOWED_CHECK_INTERVALS_HOURS)[number];

export const DEFAULT_CHECK_INTERVAL_HOURS: CheckIntervalHours = 24;

// One AND'd matching condition (002 FR-047). A `Subscription`'s primary `type`/`value`
// is the first condition; up to 2 more may ride along in `additionalConditions`, for a
// maximum of 3 ANDed conditions total, of any type mix (including repeats).
export interface SubscriptionCondition {
	type: SubscriptionType;
	value: string;
}

// FR-047: a subscription may combine at most this many conditions (ANDed) in total —
// the primary type/value plus up to MAX_SUBSCRIPTION_CONDITIONS - 1 additionalConditions.
export const MAX_SUBSCRIPTION_CONDITIONS = 3;

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
	// FR-047: 0 to (MAX_SUBSCRIPTION_CONDITIONS - 1) extra conditions ANDed with the
	// primary type/value above. Absent/empty for an ordinary single-condition subscription
	// (today's shape, unchanged). Order carries no meaning — matching and identity treat
	// the full condition set as an unordered set (see subscriptionKey).
	additionalConditions?: SubscriptionCondition[];
}

// All of a subscription's ANDed conditions — the primary type/value plus any
// additionalConditions — in a single flat list. 1 to MAX_SUBSCRIPTION_CONDITIONS entries.
export function subscriptionConditions(
	subscription: Pick<Subscription, 'type' | 'value' | 'additionalConditions'>,
): SubscriptionCondition[] {
	return [
		{ type: subscription.type, value: subscription.value },
		...(subscription.additionalConditions ?? []),
	];
}

// Percent-escape the two delimiters this key builds on — ':' between a condition's
// type and value, and '&' between conditions — plus the '%' escape char itself, so a
// value literally containing any of them can never forge a different condition set's
// key. Without this, e.g. {keyword: 'a&author:b'} and {keyword:'a', author:'b'} would
// collide. Escaping '%' first keeps the transform unambiguously reversible.
function escapeKeyPart(part: string): string {
	return part.replace(/%/g, '%25').replace(/:/g, '%3A').replace(/&/g, '%26');
}

// Order-independent identity key over a subscription's full condition set (FR-047): two
// subscriptions with the same conditions in a different order are the same subscription
// for idempotency (FR-001) and the in-flight guard (FR-022) purposes. Delimiters inside
// a type/value are escaped so distinct condition sets can never produce the same key.
export function subscriptionKey(
	subscription: Pick<Subscription, 'type' | 'value' | 'additionalConditions'>,
): string {
	return subscriptionConditions(subscription)
		.map((condition) => `${escapeKeyPart(condition.type)}:${escapeKeyPart(condition.value)}`)
		.sort()
		.join('&');
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
		isValidBackfillState(candidate.backfillState) &&
		isValidAdditionalConditions(candidate.additionalConditions)
	);
}

function isValidCondition(value: unknown): value is SubscriptionCondition {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const condition = value as Record<string, unknown>;
	return (
		typeof condition.type === 'string' &&
		(SUBSCRIPTION_TYPES as readonly string[]).includes(condition.type) &&
		typeof condition.value === 'string'
	);
}

// Optional 002 extension (FR-047): absent/empty validates as today's single-condition
// shape. When present, MUST be an array of 0 to (MAX_SUBSCRIPTION_CONDITIONS - 1) valid
// conditions — the primary condition already accounts for the first of the 3 allowed.
function isValidAdditionalConditions(value: unknown): boolean {
	if (value === undefined) {
		return true;
	}
	return (
		Array.isArray(value) &&
		value.length <= MAX_SUBSCRIPTION_CONDITIONS - 1 &&
		value.every(isValidCondition)
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
