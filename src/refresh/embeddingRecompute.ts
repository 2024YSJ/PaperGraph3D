import type { EmbeddingResult } from '../collection/embedding';
import type { EmbeddingConfig } from '../collection/embeddingUpgrade';
import { computeBaselineEmbedding } from '../collection/embedding';
import { upgradeEmbedding } from '../collection/embeddingUpgrade';

// FR-019, research.md Decision 9. Composes 002's two already-exported functions —
// never reimplements embedding math, never reaches into reembed.ts's private
// computeCanonical helper. On a 'bundled' selection the baseline vector IS the
// canonical one; otherwise attempt the upgrade and fall back to the always-present
// baseline when the upgrade returns undefined (an upgrade failure, or an
// unimplemented provider such as the LLM path pending 004) — never blocking, never
// this feature's own fallback decision (002 FR-044/FR-045).
export async function computeCanonicalEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
): Promise<EmbeddingResult> {
	if (config.provider === 'bundled') {
		return computeBaselineEmbedding(title, abstract);
	}
	const upgraded = await upgradeEmbedding(title, abstract, config);
	return upgraded ?? computeBaselineEmbedding(title, abstract);
}
