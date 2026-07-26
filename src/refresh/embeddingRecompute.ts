import type { EmbeddingFailure } from '../models/paper';
import type { EmbeddingResult } from '../collection/embedding';
import type { EmbeddingAttempts, EmbeddingConfig } from '../collection/embeddingUpgrade';
import { computeBaselineEmbedding } from '../collection/embedding';
import { upgradeEmbedding } from '../collection/embeddingUpgrade';

// FR-019, research.md Decision 9. Composes 002's two already-exported functions —
// never reimplements embedding math, never reaches into reembed.ts's private
// computeCanonical helper.
//
// The two non-canonical outcomes are kept apart, mirroring 002's collection seam: the
// model merely not being installed is the expected pre-install state and the bundled
// baseline is the right answer (002 FR-044), whereas an inference failure means the
// runtime broke and a baseline vector would misrepresent itself as an embedding in a
// space the graph cannot project. A failed recompute therefore carries no vector at
// all, and says why.
export interface CanonicalEmbedding {
	/** Absent when the canonical embedding failed — the paper stays pending. */
	result?: EmbeddingResult;
	/** Present only on failure; recorded on the paper so the fault is visible. */
	failure?: EmbeddingFailure;
}

export async function computeCanonicalEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
	attempts?: EmbeddingAttempts,
): Promise<CanonicalEmbedding> {
	const upgraded = await upgradeEmbedding(title, abstract, config, attempts);
	if (upgraded.status === 'ok') {
		return { result: upgraded.result };
	}
	if (upgraded.status === 'failed') {
		return { failure: upgraded.failure };
	}
	return { result: computeBaselineEmbedding(title, abstract) };
}
