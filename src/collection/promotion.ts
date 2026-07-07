import type { Paper, PaperCandidate } from '../models/paper';
import { toPaper } from '../models/paper';

// Thin call-through to 001's toPaper — publication year is the only hold-back trigger; an
// unenriched candidate promotes with citationsKnown = false, never withheld for missing
// citation data (FR-011/FR-016/FR-018). Kept as its own module so pipeline.ts has one
// obvious place to call. See contracts/collection-pipeline.md § promotion.ts.
export function promote(candidate: PaperCandidate): Paper | undefined {
	return toPaper(candidate);
}
