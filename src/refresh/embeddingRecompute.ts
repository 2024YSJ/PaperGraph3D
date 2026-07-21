import type { EmbeddingResult } from '../collection/embedding';
import type { EmbeddingConfig } from '../collection/embeddingUpgrade';
import { computeBaselineEmbedding } from '../collection/embedding';
import { upgradeEmbedding } from '../collection/embeddingUpgrade';

// FR-019, research.md Decision 9. Composes 002's two already-exported functions —
// never reimplements embedding math, never reaches into reembed.ts's private
// computeCanonical helper. Attempt the canonical SPECTER2 upgrade and fall back to
// the always-present baseline when it returns undefined (model not downloaded yet, or
// an inference failure) — never blocking, never this feature's own fallback decision
// (002 FR-044/FR-045). reembedCorpus converges any such paper later.
export async function computeCanonicalEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
): Promise<EmbeddingResult> {
	const upgraded = await upgradeEmbedding(title, abstract, config);
	return upgraded ?? computeBaselineEmbedding(title, abstract);
}
