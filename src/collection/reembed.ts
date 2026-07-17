import type { Paper } from '../models/paper';
import type { EmbeddingConfig } from './embeddingUpgrade';
import type { EmbeddingResult } from './embedding';
import { upgradeEmbedding } from './embeddingUpgrade';
import { SPECTER2_EMBEDDING_MODEL } from './localTransformer';

// Re-embed the persisted corpus into the canonical SPECTER2 space (002 FR-045).
// Operates directly on the persisted store (003) — it NEVER rescans the collection
// window — and only touches papers not already canonical, so papers collected before
// the model was downloaded (and any collection-time pending upgrade) self-heal.
// Sequential and yielding, so a large corpus never freezes the UI; a per-paper
// failure leaves that paper as-is (pending) and never blocks the rest.
//
// With the model fixed this is a once-in-a-lifetime migration rather than a cost paid
// on every provider switch.

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

// Cheap check (by `embeddingModel`, no inference) of whether a paper is already
// canonical — so an already-canonical paper is never needlessly re-run through an
// expensive model.
//
// Exact string equality, not a prefix test. The previous provider-based version
// matched the LLM space on the `llm:` prefix alone, which could not tell
// text-embedding-3-small (1536-d) from -3-large (3072-d): switching models left the
// corpus silently mixed-dimensionality, unprojectable by the graph feature. A single
// canonical id, dimension included, makes that unrepresentable.
function isCanonical(paper: Paper): boolean {
	return paper.embeddingModel === SPECTER2_EMBEDDING_MODEL;
}

// Produce the canonical vector for a paper, or undefined to leave it unchanged.
// Only converge when the upgrade actually succeeds: a failure (model not downloaded,
// inference error) must never overwrite a stored vector with a worse one, and the
// baseline a paper already carries is better than nothing.
async function computeCanonical(
	paper: Paper,
	config: EmbeddingConfig,
): Promise<EmbeddingResult | undefined> {
	return upgradeEmbedding(paper.title, paper.abstract, config);
}

export async function reembedCorpus(
	store: ReembedStore,
	config: EmbeddingConfig,
	yieldToEventLoop: () => Promise<void> = defaultYield,
): Promise<ReembedSummary> {
	const summary: ReembedSummary = { scanned: 0, reembedded: 0, skipped: 0, failed: 0 };

	for await (const paper of store.all()) {
		summary.scanned++;
		if (isCanonical(paper)) {
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
