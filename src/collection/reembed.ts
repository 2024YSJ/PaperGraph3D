import type { EmbeddingFailure, Paper } from '../models/paper';
import type { EmbeddingConfig, EmbeddingUpgrade } from './embeddingUpgrade';
import { createEmbeddingAttempts, hasTripped, upgradeEmbedding } from './embeddingUpgrade';
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
	/** The failure that stopped the pass, when the embedding runtime broke. */
	failure?: EmbeddingFailure;
	/** True when the pass gave up early because the runtime kept failing. */
	abandoned: boolean;
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

// Produce the canonical vector for a paper. Only converge when the upgrade actually
// succeeds: a failure (model not downloaded, inference error) must never overwrite a
// stored vector with a worse one, and the baseline a paper already carries is better
// than nothing.
async function computeCanonical(
	paper: Paper,
	config: EmbeddingConfig,
	attempts: ReturnType<typeof createEmbeddingAttempts>,
): Promise<EmbeddingUpgrade> {
	return upgradeEmbedding(paper.title, paper.abstract, config, attempts);
}

export async function reembedCorpus(
	store: ReembedStore,
	config: EmbeddingConfig,
	yieldToEventLoop: () => Promise<void> = defaultYield,
): Promise<ReembedSummary> {
	const summary: ReembedSummary = {
		scanned: 0,
		reembedded: 0,
		skipped: 0,
		failed: 0,
		abandoned: false,
	};
	const attempts = createEmbeddingAttempts();

	for await (const paper of store.all()) {
		summary.scanned++;
		if (isCanonical(paper)) {
			summary.skipped++;
			continue;
		}

		const computed = await computeCanonical(paper, config, attempts);
		if (computed.status !== 'ok') {
			// Could not converge this paper — leave its stored vector as-is (pending).
			summary.failed++;
			if (computed.status === 'failed') {
				summary.failure = computed.failure;
				// Walking the rest of the corpus to fail identically on every paper
				// wastes minutes and buries the real event. Stop and report: this is a
				// converge pass, so whatever is left is still there for the next one.
				if (hasTripped(attempts)) {
					summary.abandoned = true;
					return summary;
				}
			}
			await yieldToEventLoop();
			continue;
		}
		const result = computed.result;
		if (result.embeddingModel === paper.embeddingModel) {
			// Already in the target space by model id — nothing to write.
			summary.skipped++;
			await yieldToEventLoop();
			continue;
		}

		try {
			await store.upsert({
				paper: {
					...paper,
					embedding: result.embedding,
					embeddingModel: result.embeddingModel,
					embeddingSource: result.embeddingSource,
					// Converging clears any recorded failure: the paper now has a
					// canonical vector, so the old complaint no longer describes it.
					embeddingFailure: null,
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
