import type { EmbeddingResult } from './embedding';
import { MODEL_ID, type LocalModelLocation } from './modelAssets';

// On-device SPECTER2 embedding (002 FR-046). SPECTER2 is a BERT-base encoder trained
// on 6M citation triplets across 23 fields of study, with the `proximity` adapter
// merged into the ONNX graph at conversion time — citation-trained representations are
// what make a similarity graph meaningful (a plain scientific LM like SciBERT scores
// 59.6 on SciDocs vs SPECTER's 80.0; the gap is the citation objective, not the domain).
//
// The model is fixed, not user-selectable: the corpus's canonical embedding space must
// be exactly one space for the graph feature to project papers together (001 FR-020),
// and a swappable model means a swappable dimensionality.
//
// Weights are not bundled — they are downloaded once into the plugin folder (see
// modelAssets.ts) and everything after that is offline. Until they are present this
// module reports unavailable and callers keep the bundled baseline (002 FR-044/FR-045).

// The canonical embedding-space id, shaped like the baseline's `local-hashtf-v1-d2048`.
// The dimension is baked in, so any future model change is necessarily a different id
// and reembed.ts converges the corpus onto it (001 FR-022).
export const SPECTER2_EMBEDDING_MODEL = 'local-specter2-proximity-v1-d768';

export const SPECTER2_EMBEDDING_DIM = 768;

// The surface we use is this narrow.
type Extractor = (
	text: string,
	options: { pooling: 'cls'; normalize: boolean },
) => Promise<{ data: ArrayLike<number> }>;

// pipeline() is generic over every task type, and resolving it produces a union
// TypeScript refuses to represent ("union type that is too complex"). Narrowing the
// signature to the one task we call sidesteps the instantiation entirely.
type CreateExtractor = (
	task: 'feature-extraction',
	model: string,
	options: { dtype: 'q8' },
) => Promise<Extractor>;

let cachedLocation: string | undefined;
let cachedPipeline: Promise<Extractor> | undefined;

async function getPipeline(location: LocalModelLocation): Promise<Extractor> {
	const key = `${location.modelsBaseUrl}|${location.wasmBaseUrl}`;
	if (cachedLocation !== key || cachedPipeline === undefined) {
		cachedLocation = key;
		cachedPipeline = (async () => {
			const transformers = await import('@huggingface/transformers');

			// Local-only, always. allowRemoteModels=false is what makes "offline after
			// first download" a guarantee rather than an intention: if an asset is
			// missing the load fails loudly here instead of silently reaching the
			// network (constitution Principle IV).
			transformers.env.allowLocalModels = true;
			transformers.env.allowRemoteModels = false;
			transformers.env.localModelPath = location.modelsBaseUrl;

			// Point onnxruntime at the WASM binary in the plugin folder. Left unset,
			// transformers.js defaults wasmPaths to a jsDelivr CDN URL and would reach
			// the network on every load — the one remaining silent-network path.
			const wasm = transformers.env.backends.onnx.wasm;
			if (wasm === undefined) {
				throw new Error('onnxruntime WASM backend unavailable');
			}
			wasm.wasmPaths = location.wasmBaseUrl;

			const createExtractor = transformers.pipeline as unknown as CreateExtractor;
			return await createExtractor('feature-extraction', MODEL_ID, {
				// Resolves to onnx/model_quantized.onnx. The fp32 export is a small graph
				// plus a 420 MB external-data sidecar, so int8 is the only shipped weight.
				dtype: 'q8',
			});
		})();
	}
	return cachedPipeline;
}

/** Drop the cached pipeline, e.g. after assets are re-downloaded or removed. */
export function resetPipeline(): void {
	cachedLocation = undefined;
	cachedPipeline = undefined;
}

export interface EmbeddingDiagnostics {
	readonly crossOriginIsolated: boolean;
	readonly numThreads: number | undefined;
	readonly wasmPaths: string;
	readonly initMs: number;
	readonly perPaperMs: number[];
	readonly dimension: number;
	/** Cosine against the Python int8 reference for the same pair; ~0.93 means the JS path matches. */
	readonly relatedCosine: number;
	readonly unrelatedCosine: number;
}

const DIAG_PAPERS: readonly (readonly [string, string])[] = [
	[
		'SPECTER: Document-level Representation Learning using Citation-informed Transformers',
		'Representation learning is a critical ingredient for natural language processing systems. We propose SPECTER, a new method to generate document-level embedding of scientific documents based on pretraining a Transformer language model on a powerful signal of document-level relatedness: the citation graph.',
	],
	[
		'Neighborhood Contrastive Learning for Scientific Document Representations with Citation Embeddings',
		'Learning scientific document representations can be substantially improved through contrastive learning objectives, where the challenge lies in creating positive and negative training samples that encode the desired similarity semantics.',
	],
	[
		'Attention Is All You Need',
		'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
	],
];

function cosine(a: readonly number[], b: readonly number[]): number {
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
	}
	return dot; // both vectors are L2-normalized
}

/**
 * Measure the embedding runtime in the environment it actually ships to. Every timing
 * estimate for this feature has been extrapolated from published benchmarks that do
 * not match our configuration (BERT-base int8, single-threaded WASM, Electron); this
 * replaces the extrapolation with a number.
 *
 * The cosine checks are a correctness guard, not a benchmark: if the JS path
 * reproduces the Python reference (~0.93 related / ~0.88 unrelated), tokenization and
 * CLS pooling are right; if it does not, the numbers are fast but meaningless.
 */
export async function embeddingDiagnostics(
	location: LocalModelLocation,
): Promise<EmbeddingDiagnostics> {
	const transformers = await import('@huggingface/transformers');

	const startInit = performance.now();
	const extractor = await getPipeline(location);
	const initMs = performance.now() - startInit;

	const vectors: number[][] = [];
	const perPaperMs: number[] = [];
	for (const [title, abstract] of DIAG_PAPERS) {
		const start = performance.now();
		const output = await extractor(`${title}[SEP]${abstract}`, {
			pooling: 'cls',
			normalize: true,
		});
		perPaperMs.push(performance.now() - start);
		vectors.push(Array.from(output.data, (value) => Number(value)));
	}

	const wasm = transformers.env.backends.onnx.wasm;
	// wasmPaths is a prefix string OR a per-file record; the whole point of reading it
	// back is to confirm it is our plugin folder and not the jsDelivr CDN default, so
	// it must not collapse to '[object Object]'.
	const paths = wasm?.wasmPaths;
	return {
		crossOriginIsolated: self.crossOriginIsolated,
		numThreads: wasm?.numThreads,
		wasmPaths:
			paths === undefined
				? '(unset)'
				: typeof paths === 'string'
					? paths
					: JSON.stringify(paths),
		initMs,
		perPaperMs,
		dimension: vectors[0]?.length ?? 0,
		relatedCosine: cosine(vectors[0] ?? [], vectors[1] ?? []),
		unrelatedCosine: cosine(vectors[0] ?? [], vectors[2] ?? []),
	};
}

/**
 * Embed one paper. Returns undefined when the assets are absent or inference fails —
 * the caller keeps the baseline vector rather than blocking persistence (001 FR-021).
 * Throws nothing; upgradeEmbedding()'s try/catch is the outer net.
 */
export async function specter2Embedding(
	title: string,
	abstract: string,
	location: LocalModelLocation,
): Promise<EmbeddingResult | undefined> {
	const extractor = await getPipeline(location);

	// SPECTER2's trained input format: title, a [SEP], then the abstract. Verified that
	// a literal '[SEP]' in the string tokenizes identically to tokenizer.sep_token, so
	// this matches how the model was trained. A space-joined string would quietly
	// produce worse embeddings, as would mean pooling instead of the CLS token.
	const text = abstract.length > 0 ? `${title}[SEP]${abstract}` : title;
	const output = await extractor(text, { pooling: 'cls', normalize: true });
	const embedding = Array.from(output.data, (value) => Number(value));

	if (
		embedding.length !== SPECTER2_EMBEDDING_DIM ||
		embedding.some((value) => !Number.isFinite(value))
	) {
		return undefined;
	}

	return {
		embedding,
		embeddingModel: SPECTER2_EMBEDDING_MODEL,
		embeddingSource: 'local',
	};
}
