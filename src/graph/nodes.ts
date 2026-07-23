import type { Paper } from '../models/paper';
import { isUncited } from '../models/uncited';
import type { GraphNode } from './types';

// A node minus its layout position — `convert.ts` assigns the projected or fallback
// position (kept separate so node identity/metadata is independent of the projection).
export type NodeBase = Omit<GraphNode, 'position' | 'positionSource'>;

// One record → node fields. Returns undefined to EXCLUDE a record: no numeric
// publication year (FR-002), or a malformed record whose required fields can't be read
// (FR-006) — either way the run is never failed, the record is just skipped. `uncited`
// comes only from the shared rule (FR-012), never from in-graph inbound degree.
export function toNodeBase(paper: Paper): NodeBase | undefined {
	if (paper === null || typeof paper !== 'object') return undefined;
	if (typeof paper.sourceId !== 'string' || typeof paper.title !== 'string') return undefined;
	if (typeof paper.publicationYear !== 'number' || !Number.isFinite(paper.publicationYear)) {
		return undefined; // year-less / malformed ⇒ excluded
	}
	const citationCount = typeof paper.citationCount === 'number' ? paper.citationCount : 0;
	const citationsKnown = paper.citationsKnown === true;
	return {
		id: paper.sourceId,
		title: paper.title,
		// Full list, order preserved; defensively coerced (a malformed non-array authors
		// field yields [] rather than excluding the node — authors is display-only, not
		// an identity/layout field).
		authors: Array.isArray(paper.authors) ? [...paper.authors] : [],
		publicationYear: paper.publicationYear,
		citationCount,
		citationsKnown,
		uncited: isUncited({ citationCount, citationsKnown }),
	};
}
