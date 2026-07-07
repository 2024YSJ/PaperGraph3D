import type {
	Subscription,
	SubscriptionType,
	CheckIntervalHours,
} from '../models/subscription';
import {
	DEFAULT_CHECK_INTERVAL_HOURS,
	assignCheckInterval,
	isValidSubscription,
} from '../models/subscription';

// Persistence + CRUD over 001's Subscription type (User Story 1), plus the backfill
// watermark operations (User Story 5). Builds no UI — 008's settings screen calls these
// directly. See contracts/collection-pipeline.md § subscriptionStore.ts for the
// authoritative behavior guarantees.

export interface SubscriptionStoreDeps {
	// Returns whatever loadData() last read back — NOT pre-validated as Subscription[].
	// createSubscriptionStore validates every element through 001's isValidSubscription.
	load: () => Promise<unknown[]>;
	// The caller (main.ts, T020) implements this as a read-modify-write against the plugin's
	// single persisted object ({ settings, subscriptions }) so a subscription save never
	// clobbers sibling settings (research.md Decision 15).
	save: (subscriptions: Subscription[]) => Promise<void>;
	// Fired only after a genuinely-new subscription is persisted (never on an idempotent
	// hit). Wired to the scheduler's checkNow for an immediate first check (FR-028).
	onRegistered?: (subscription: Subscription) => void;
	// Fired only after a validated, non-no-op backfill request set/lowered backfillState.
	// Wired to the scheduler's backfillNow (FR-033).
	onBackfillRequested?: (subscription: Subscription) => void;
	// Fired at most once, the first time load()'s result is consumed, if any element failed
	// isValidSubscription and was dropped.
	onInvalidData?: (droppedCount: number) => void;
}

export interface SubscriptionStore {
	list(): Subscription[];
	register(input: {
		type: SubscriptionType;
		value: string;
		label?: string;
		checkIntervalHours?: CheckIntervalHours;
	}): Promise<Subscription>;
	remove(subscription: Subscription): Promise<void>;
	setEnabled(subscription: Subscription, enabled: boolean): Promise<void>;
	setCheckInterval(subscription: Subscription, requested: number): Promise<CheckIntervalHours>;
	recordChecked(
		subscription: Subscription,
		checkedThrough: number,
		windowFrom: number,
	): Promise<void>;
	requestBackfill(subscription: Subscription, targetFrom: number): Promise<void>;
	recordBackfillProgress(subscription: Subscription, cursor: number): Promise<void>;
	cancelBackfill(subscription: Subscription): Promise<void>;
	// Resolves once the initial load() has been consumed — lets a caller (or a manual
	// quickstart script) await readiness before inspecting list() synchronously.
	ready(): Promise<void>;
}

function keyOf(subscription: { type: SubscriptionType; value: string }): string {
	return `${subscription.type}:${subscription.value}`;
}

export function createSubscriptionStore(deps: SubscriptionStoreDeps): SubscriptionStore {
	let subscriptions: Subscription[] = [];
	let loaded = false;
	let loadPromise: Promise<void> | undefined;

	function consumeLoad(raw: unknown[]): void {
		const valid: Subscription[] = [];
		let dropped = 0;
		for (const element of raw) {
			if (isValidSubscription(element)) {
				valid.push(element);
			} else {
				dropped += 1;
			}
		}
		subscriptions = valid;
		loaded = true;
		if (dropped > 0) {
			deps.onInvalidData?.(dropped);
		}
	}

	function ensureLoaded(): Promise<void> {
		if (loaded) {
			return Promise.resolve();
		}
		if (loadPromise === undefined) {
			loadPromise = deps.load().then(consumeLoad);
		}
		return loadPromise;
	}

	// Kick off the initial load eagerly so list() reflects persisted data as soon as it
	// resolves; every async mutator also awaits ensureLoaded() before touching state.
	void ensureLoaded();

	function find(subscription: { type: SubscriptionType; value: string }): Subscription | undefined {
		const key = keyOf(subscription);
		return subscriptions.find((candidate) => keyOf(candidate) === key);
	}

	function persist(): Promise<void> {
		return deps.save(subscriptions.map((subscription) => ({ ...subscription })));
	}

	function list(): Subscription[] {
		return subscriptions.map((subscription) => ({ ...subscription }));
	}

	async function register(input: {
		type: SubscriptionType;
		value: string;
		label?: string;
		checkIntervalHours?: CheckIntervalHours;
	}): Promise<Subscription> {
		await ensureLoaded();

		// FR-025: reject an empty/whitespace-only value before anything else.
		if (input.value.trim().length === 0) {
			throw new Error('Subscription value must not be empty');
		}

		// FR-001: idempotent on (type, value) — return the existing one unchanged.
		const existing = find(input);
		if (existing !== undefined) {
			return { ...existing };
		}

		const subscription: Subscription = {
			type: input.type,
			value: input.value,
			label: input.label ?? input.value,
			checkIntervalHours: input.checkIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS,
			lastCheckedAt: null,
			enabled: true,
		};
		subscriptions.push(subscription);
		await persist();
		deps.onRegistered?.({ ...subscription });
		return { ...subscription };
	}

	async function remove(subscription: Subscription): Promise<void> {
		await ensureLoaded();
		const key = keyOf(subscription);
		const next = subscriptions.filter((candidate) => keyOf(candidate) !== key);
		if (next.length === subscriptions.length) {
			return;
		}
		subscriptions = next;
		await persist();
	}

	async function setEnabled(subscription: Subscription, enabled: boolean): Promise<void> {
		await ensureLoaded();
		const stored = find(subscription);
		if (stored === undefined || stored.enabled === enabled) {
			return;
		}
		stored.enabled = enabled;
		await persist();
	}

	async function setCheckInterval(
		subscription: Subscription,
		requested: number,
	): Promise<CheckIntervalHours> {
		await ensureLoaded();
		const stored = find(subscription);
		if (stored === undefined) {
			return subscription.checkIntervalHours;
		}
		const next = assignCheckInterval(stored.checkIntervalHours, requested);
		if (next !== stored.checkIntervalHours) {
			stored.checkIntervalHours = next;
			await persist();
		}
		return next;
	}

	async function recordChecked(
		subscription: Subscription,
		checkedThrough: number,
		windowFrom: number,
	): Promise<void> {
		await ensureLoaded();
		const stored = find(subscription);
		if (stored === undefined) {
			// Deleted while its check was in flight — never re-insert (FR-006).
			return;
		}
		// Never move lastCheckedAt backward (FR-006/FR-024). A clock-backward empty window's
		// checkedThrough (== earlier now) is <= the stored value, so this no-ops.
		if (stored.lastCheckedAt !== null && checkedThrough <= stored.lastCheckedAt) {
			return;
		}
		stored.lastCheckedAt = checkedThrough;
		// Atomically initialize coveredFrom on the first successful check (FR-035); once set,
		// never raise it.
		if (stored.coveredFrom === undefined || stored.coveredFrom === null) {
			stored.coveredFrom = windowFrom;
		}
		await persist();
	}

	async function requestBackfill(subscription: Subscription, targetFrom: number): Promise<void> {
		await ensureLoaded();
		if (!Number.isFinite(targetFrom)) {
			throw new Error('Backfill targetFrom must be a finite epoch-ms value');
		}
		if (targetFrom > Date.now()) {
			throw new Error('Backfill targetFrom must not be in the future');
		}
		const stored = find(subscription);
		if (stored === undefined) {
			return;
		}
		const coveredFrom = stored.coveredFrom;
		// No-op when there is nothing older to fill — including when no forward coverage
		// exists yet (coveredFrom unset) (FR-038).
		if (coveredFrom === undefined || coveredFrom === null || targetFrom >= coveredFrom) {
			return;
		}
		const active = stored.backfillState;
		if (active !== undefined && active !== null) {
			// A further-past request mid-run: lower BOTH targetFrom and cursor so the newly
			// added older span is actually walked (FR-036). A not-further-past request during
			// an active run is already being covered — no-op.
			if (targetFrom >= active.targetFrom) {
				return;
			}
			stored.backfillState = { targetFrom, cursor: targetFrom };
		} else {
			stored.backfillState = { targetFrom, cursor: targetFrom };
		}
		await persist();
		deps.onBackfillRequested?.({ ...stored });
	}

	async function recordBackfillProgress(subscription: Subscription, cursor: number): Promise<void> {
		await ensureLoaded();
		const stored = find(subscription);
		if (stored === undefined) {
			return;
		}
		const state = stored.backfillState;
		// No-op when backfillState was cleared out from under an in-flight pass (e.g. by
		// cancelBackfill) — never re-create it (FR-043 race).
		if (state === undefined || state === null) {
			return;
		}
		const nextCursor = Math.max(state.cursor, cursor);
		const coveredFrom = stored.coveredFrom;
		if (coveredFrom !== undefined && coveredFrom !== null && nextCursor >= coveredFrom) {
			// Completion: lower the backward floor and clear the active backfill (FR-036).
			stored.coveredFrom = state.targetFrom;
			stored.backfillState = null;
		} else {
			stored.backfillState = { targetFrom: state.targetFrom, cursor: nextCursor };
		}
		await persist();
	}

	async function cancelBackfill(subscription: Subscription): Promise<void> {
		await ensureLoaded();
		const stored = find(subscription);
		if (stored === undefined || stored.backfillState === undefined || stored.backfillState === null) {
			return;
		}
		// Clear state but LEAVE coveredFrom untouched — the walked span is not contiguous
		// with the existing floor except at full completion, so crediting the cursor would
		// falsely mark the unwalked middle span as covered (FR-043).
		stored.backfillState = null;
		await persist();
	}

	return {
		list,
		register,
		remove,
		setEnabled,
		setCheckInterval,
		recordChecked,
		requestBackfill,
		recordBackfillProgress,
		cancelBackfill,
		ready: ensureLoaded,
	};
}
