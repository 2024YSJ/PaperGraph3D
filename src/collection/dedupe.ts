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

// Outcome of claiming a sourceId this run:
//   'new'             — not seen this run and not yet persisted: process it normally.
//   'duplicate'       — already seen this run: skip entirely.
//   'alreadyPersisted'— persisted by an earlier run/subscription: don't re-process it,
//                       but the caller still records THIS subscription's provenance
//                       (recordCollectedVia) before skipping. Marked seen so a paper
//                       appearing twice in one run's feed is only unioned once.
export type ClaimResult = 'new' | 'duplicate' | 'alreadyPersisted';

// Classifies a sourceId for this run and records it as seen (except for a same-run
// duplicate, which was already recorded on its first sighting).
export async function claim(
	state: CollectionRunState,
	sourceId: PaperSourceId,
): Promise<ClaimResult> {
	if (state.seen.has(sourceId)) {
		return 'duplicate';
	}
	if (await state.alreadyPersisted(sourceId)) {
		state.seen.add(sourceId);
		return 'alreadyPersisted';
	}
	state.seen.add(sourceId);
	return 'new';
}
