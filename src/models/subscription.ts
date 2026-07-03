export type SubscriptionType = 'keyword' | 'author' | 'arxivCategory';

export type CheckIntervalHours = 6 | 12 | 24 | 48 | 72;

export const ALLOWED_CHECK_INTERVALS_HOURS: readonly CheckIntervalHours[] = [6, 12, 24, 48, 72];

export const DEFAULT_CHECK_INTERVAL_HOURS: CheckIntervalHours = 24;

export interface Subscription {
	type: SubscriptionType;
	value: string;
	label: string;
	checkIntervalHours: CheckIntervalHours;
	lastCheckedAt: number | null;
	enabled: boolean;
}

const SUBSCRIPTION_TYPES: readonly SubscriptionType[] = ['keyword', 'author', 'arxivCategory'];

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

export function assignCheckInterval(
	current: CheckIntervalHours,
	requested: number,
): CheckIntervalHours {
	return isCheckIntervalHours(requested) ? requested : current;
}
