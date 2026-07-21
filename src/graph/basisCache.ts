import type { ProjectionBasis } from './types';

const REFIT_GROWTH_RATIO = 0.2; // ≥20% growth since the last fit
const REFIT_MIN_NEW = 25; // AND ≥25 new canonical papers

// Decide whether to refit the projection basis (006 FR-010; research.md §6). Refit when
// there is no usable basis (missing / wrong model / wrong dimension), or the canonical
// corpus has grown ≥20% AND by ≥25 papers since the basis was fit. The explicit
// "recompute layout" trigger is handled by the caller (convert.ts's `recompute`
// option); a canonical-model change is caught by the model-id mismatch here.
export function shouldRefit(
	basis: ProjectionBasis | undefined,
	currentCanonicalCount: number,
	canonicalModel: string,
	dim: number,
): boolean {
	if (basis === undefined) return true;
	if (basis.embeddingModel !== canonicalModel) return true;
	if (basis.mean.length !== dim || basis.axes[0].length !== dim || basis.axes[1].length !== dim) {
		return true;
	}
	const grew = currentCanonicalCount - basis.fitCount;
	if (grew < REFIT_MIN_NEW) return false;
	return grew >= basis.fitCount * REFIT_GROWTH_RATIO;
}
