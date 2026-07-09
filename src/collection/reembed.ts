import type { Paper } from '../models/paper';
import type { EmbeddingConfig } from './embeddingUpgrade';
import type { EmbeddingResult } from './embedding';
import { BASELINE_EMBEDDING_MODEL, computeBaselineEmbedding } from './embedding';
import { upgradeEmbedding } from './embeddingUpgrade';
import { localTransformerModelIdPrefix } from './localTransformer';

// Re-embed the persisted corpus into the currently-selected canonical embedding
// space (001 FR-022 / 002 FR-045). Operates directly on the persisted store (003)
// — it NEVER rescans the collection window — and only touches papers not already
// in the canonical space, so after a provider/model switch the corpus converges to
// one space, and any collection-time pending upgrade self-heals. Sequential and
// yielding, so a large corpus never freezes the UI; a per-paper failure leaves
// that paper as-is (pending) and never blocks the rest.

// Minimal store surface (matches PaperStore.all()/upsert(), 003), kept as an
// interface so this module stays offline-testable without a real Obsidian FileStore.
export interface ReembedStore {
	all(): AsyncIterable<Paper>;
	upsert(input: { paper: Paper }): Promise<void>;
}

export interface ReembedSummary {
	scanned: number;
	reembedded: number;
	skipped: number;
	failed: number;
}

function defaultYield(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}

// Cheap check (by `embeddingModel`, no inference) of whether a paper is already in
// the canonical space for the current provider — so an already-canonical paper is
// never needlessly re-run through an expensive model.
function isCanonical(paper: Paper, config: EmbeddingConfig): boolean {
	const model = paper.embeddingModel;
	if (model === null) {
		return false;
	}
	switch (config.provider) {
		case 'bundled':
			return model === BASELINE_EMBEDDING_MODEL;
		case 'local-transformer': {
			const spec = config.localModel?.trim();
			if (spec === undefined || spec.length === 0) {
				return false;
			}
			return model.startsWith(localTransformerModelIdPrefix(spec));
		}
		case 'llm':
			return model.startsWith('llm:');
	}
}

// Produce the canonical vector for a paper, or undefined to leave it unchanged
// (baseline compute failed, or a selected non-bundled upgrade could not be
// produced — a failure must never overwrite a stored vector with a worse one).
async function computeCanonical(
	paper: Paper,
	config: EmbeddingConfig,
): Promise<EmbeddingResult | undefined> {
	if (config.provider === 'bundled') {
		try {
			return computeBaselineEmbedding(paper.title, paper.abstract);
		} catch {
			return undefined;
		}
	}
	// Non-bundled: only converge when the upgrade actually succeeds.
	return upgradeEmbedding(paper.title, paper.abstract, config);
}

export async function reembedCorpus(
	store: ReembedStore,
	config: EmbeddingConfig,
	yieldToEventLoop: () => Promise<void> = defaultYield,
): Promise<ReembedSummary> {
	const summary: ReembedSummary = { scanned: 0, reembedded: 0, skipped: 0, failed: 0 };

	// The LLM upgrade is a 004-owned hook not yet implemented; there is no canonical
	// LLM space to converge to, so re-embedding is a no-op that must not destroy
	// existing vectors. (Removed once the LLM provider ships.)
	if (config.provider === 'llm') {
		return summary;
	}

	for await (const paper of store.all()) {
		summary.scanned++;
		if (isCanonical(paper, config)) {
			summary.skipped++;
			continue;
		}

		const computed = await computeCanonical(paper, config);
		if (computed === undefined) {
			// Could not converge this paper — leave it as-is (pending).
			summary.failed++;
			await yieldToEventLoop();
			continue;
		}
		if (computed.embeddingModel === paper.embeddingModel) {
			// Already in the target space by model id — nothing to write.
			summary.skipped++;
			await yieldToEventLoop();
			continue;
		}

		try {
			await store.upsert({
				paper: {
					...paper,
					embedding: computed.embedding,
					embeddingModel: computed.embeddingModel,
					embeddingSource: computed.embeddingSource,
				},
			});
			summary.reembedded++;
		} catch {
			summary.failed++;
		}
		await yieldToEventLoop();
	}

	return summary;
}
