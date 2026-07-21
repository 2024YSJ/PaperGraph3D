import type { PaperSourceId } from '../models/paper';
import type { GraphConnection } from './types';

// Directional citation edges A→B, one per reference B that is itself a node (exact
// PaperSourceId equality, 006 OQ-2) and is not A (no self-loop). A reference that
// resolves to no node — a dangling target, or a stored paper excluded for lacking a
// year — produces no edge and no fabricated node (FR-003/FR-005). Empty/undefined
// references ⇒ no edges (OQ-1). Cited-by is never emitted; the consumer inverts these
// (FR-004). `nodeIds` is the set of ids that became nodes, so edges only ever connect
// nodes.
export function buildConnections(
	from: PaperSourceId,
	references: readonly PaperSourceId[] | undefined,
	nodeIds: ReadonlySet<PaperSourceId>,
): GraphConnection[] {
	if (references === undefined) return [];
	const connections: GraphConnection[] = [];
	const seen = new Set<PaperSourceId>();
	for (const to of references) {
		if (to === from) continue; // no self-loop
		if (seen.has(to)) continue; // dedupe repeated references
		if (!nodeIds.has(to)) continue; // dangling / not-a-node ⇒ drop
		seen.add(to);
		connections.push({ from, to });
	}
	return connections;
}
