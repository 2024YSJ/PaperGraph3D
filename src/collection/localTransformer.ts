import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import type { EmbeddingResult } from './embedding';

// User-supplied on-device local transformer embedding provider (002 FR-046). The
// user selects this provider and points `localEmbeddingModel` at a model by a
// local file path or a URL; this module runs that transformer on-device and mean-
// pools + L2-normalizes it into a sentence embedding. The @huggingface/transformers
// runtime is loaded via a LAZY DYNAMIC IMPORT so the heavy dependency is pulled in
// only when this provider is actually selected — never on a normal load. Any
// failure (runtime absent, model unreadable, inference error) returns undefined so
// the caller keeps the bundled baseline (pending upgrade), never blocking
// persistence (002 FR-045).

// One cached pipeline per model spec: initializing a transformer is expensive, so
// a model is loaded once per session and reused across a collection batch. A
// changed model spec rebuilds the cache (and is a provider change that re-embeds).
let cachedModelSpec: string | undefined;
let cachedPipeline: Promise<FeatureExtractionPipeline> | undefined;

async function getPipeline(
	modelSpec: string,
): Promise<FeatureExtractionPipeline> {
	if (cachedModelSpec !== modelSpec || cachedPipeline === undefined) {
		cachedModelSpec = modelSpec;
		cachedPipeline = (async () => {
			const transformers = await import('@huggingface/transformers');
			// The user may point at either a local file path (fully offline) or a
			// remote URL / repo id (a user-initiated download, disclosed per
			// constitution Principle IV).
			transformers.env.allowLocalModels = true;
			transformers.env.allowRemoteModels = true;
			return transformers.pipeline('feature-extraction', modelSpec);
		})();
	}
	return cachedPipeline;
}

// A stable identifier for the produced embedding space, so switching to a
// different model (a different `embeddingModel`) is detected as a provider change
// that re-embeds the corpus (001 FR-020/FR-022). Includes the output dimension,
// which varies by model.
function embeddingModelId(modelSpec: string, dimension: number): string {
	const normalized = modelSpec.trim().replace(/\s+/g, '_');
	return `local-transformer:${normalized}:d${dimension}`;
}

export async function localTransformerEmbedding(
	title: string,
	abstract: string,
	modelSpec: string,
): Promise<EmbeddingResult | undefined> {
	const extractor = await getPipeline(modelSpec);
	const text = abstract.length > 0 ? `${title} ${abstract}` : title;

	// Mean-pool over tokens and L2-normalize — the standard sentence-embedding
	// reduction, so a dot product is a cosine similarity (matches 001 FR-019).
	const output = await extractor(text, { pooling: 'mean', normalize: true });
	const embedding = Array.from(output.data, (value) => Number(value));

	if (
		embedding.length === 0 ||
		embedding.some((value) => !Number.isFinite(value))
	) {
		return undefined;
	}

	return {
		embedding,
		embeddingModel: embeddingModelId(modelSpec, embedding.length),
		embeddingSource: 'local',
	};
}
