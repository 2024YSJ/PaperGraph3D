import type { PaperSourceId } from '../models/paper';
import type { CollectionRunState } from './types';

export type { CollectionRunState } from './types';

// Per-run dedup state (FR-009): a seen-set across subscriptions/overlapping windows in this
// one collection run, plus a hook into 003's persisted-store existence check. Never
// survives past a single tick/catch-up/backfill pass. See data-model.md § Dedup and batch
// state.
export function createCollectionRunState(
	alreadyPersisted: (id: PaperSourceId) => Promise<boolean>,
): CollectionRunState {
	return { seen: new Set<PaperSourceId>(), alreadyPersisted };
}

// Returns true if this sourceId has not yet been processed in this run and is not already
// persisted; records it as seen when true. A false result means "duplicate, skip".
export async function claim(state: CollectionRunState, sourceId: PaperSourceId): Promise<boolean> {
	if (state.seen.has(sourceId)) {
		return false;
	}
	if (await state.alreadyPersisted(sourceId)) {
		return false;
	}
	state.seen.add(sourceId);
	return true;
}
