// Minimal structural shape — NOT tied to the full Paper type — so this helper is
// satisfied identically by SummarizationInput (this feature's own call site,
// hook.ts) and, with no cast, a future full Paper (007's call site) (data-model.md
// §4, research.md §9).
export interface UncitedCheckInput {
	citationsKnown: boolean;
	citationCount: number;
}

// Returns true only when the citation count is CONFIRMED zero. An un-enriched
// citationCount === 0 (citationsKnown === false) is NOT uncited — it's unknown
// (spec Edge Cases; 002 FR-016/FR-018). Reliability of a true result depends on
// 002 enriching a paper's citation count before promotion when this feature is on
// (002 FR-016).
export function isUncited(input: UncitedCheckInput): boolean {
	return input.citationsKnown && input.citationCount === 0;
}
