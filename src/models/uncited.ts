// Shared "uncited" rule, owned by no single feature so 004 (summary/future-
// directions), 006 (graph nodes), and 007 (uncited-node styling) all import the ONE
// definition and can never drift on which papers count as uncited (006 FR-012,
// 006 spec Clarifications OQ-5). It lives beside paper.ts because it reads only the
// Paper citation fields.

// Minimal structural shape — NOT tied to the full Paper type — so this helper is
// satisfied identically by SummarizationInput (004's hook.ts call site) and, with no
// cast, a full Paper (006/007's call sites).
export interface UncitedCheckInput {
	citationsKnown: boolean;
	citationCount: number;
}

// Returns true only when the citation count is CONFIRMED zero. An un-enriched
// citationCount === 0 (citationsKnown === false) is NOT uncited — it's unknown
// (spec Edge Cases; 002 FR-016/FR-018). Reliability of a true result depends on 002
// enriching a paper's citation count before promotion.
export function isUncited(input: UncitedCheckInput): boolean {
	return input.citationsKnown && input.citationCount === 0;
}
