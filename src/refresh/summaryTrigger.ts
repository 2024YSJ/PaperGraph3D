import type { Paper } from '../models/paper';

// "Uncited" is a CONFIRMED zero — citationsKnown === true && citationCount === 0
// (001/002 FR-018) — never a bare citationCount === 0, which would also match an
// un-enriched (citationsKnown === false) paper 002 FR-018 requires treating as
// not-yet-uncited.
function isUncited(p: { citationsKnown: boolean; citationCount: number }): boolean {
	return p.citationsKnown === true && p.citationCount === 0;
}

// Pure predicate — FR-014 ∨ FR-020 (research.md Decision 5). Regenerate the 004
// summary/future-directions text when the abstract changed OR the paper's uncited
// status flipped. `fresh` carries the EFFECTIVE post-refresh citation state
// (fetched values on a Semantic Scholar success, else the carried-through stored
// values, FR-021) — so an unavailable lookup never reads as a status change.
export function shouldRegenerateSummary(
	stored: Paper,
	fresh: { abstract: string; citationCount: number; citationsKnown: boolean },
): boolean {
	return fresh.abstract !== stored.abstract || isUncited(stored) !== isUncited(fresh);
}
