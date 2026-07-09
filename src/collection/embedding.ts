import type { EmbeddingSource } from '../models/paper';

// Bundled local baseline content embedding (001 FR-019 / 002 FR-044): a
// deterministic, offline, dependency-free, L2-normalized hashed term-frequency
// vector over the paper's title + abstract. It uses NO corpus statistics (no live
// IDF), so a given text always maps to the same vector no matter how the corpus
// grows — the stability the canonical-space invariant needs (001 FR-022). Quality
// is lexical (shared-vocabulary similarity); semantic depth is the job of the
// optional local-transformer / LLM providers (002 FR-045/FR-046). This baseline is
// ALWAYS computed as the fallback, regardless of the selected provider, so no paper
// is ever persisted without a vector and embedding never blocks persistence.

// The dimensionality is baked into the model id, so changing it is a provider
// change that re-embeds the corpus (001 FR-022). 2048 keeps hash-collision noise
// low for abstract-length text while keeping the later PCA (006) affordable.
export const BASELINE_EMBEDDING_DIM = 2048;

export const BASELINE_EMBEDDING_MODEL = `local-hashtf-v1-d${BASELINE_EMBEDDING_DIM}`;

export interface EmbeddingResult {
	embedding: number[];
	embeddingModel: string;
	embeddingSource: EmbeddingSource;
}

// FNV-1a (32-bit), deterministic and dependency-free. Math.imul keeps the multiply
// in 32-bit; the final `>>> 0` yields an unsigned integer for the modulo/sign.
function fnv1a(token: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < token.length; i++) {
		hash ^= token.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// NFKC-normalize, lowercase, then split on any run of non-letter/non-number
// (Unicode-aware) and drop empties. Keeps alphanumerics across scripts; strips
// punctuation and math symbols that would only add hashing noise.
function tokenize(text: string): string[] {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((token) => token.length > 0);
}

// Compute the mandatory bundled baseline vector. Never throws for ordinary input;
// an empty text yields a zero vector (still a valid, if degenerate, embedding — a
// valid Paper always has a title, so this is only a defensive edge).
export function computeBaselineEmbedding(
	title: string,
	abstract: string,
): EmbeddingResult {
	const text = abstract.length > 0 ? `${title} ${abstract}` : title;
	const tokens = tokenize(text);

	// Count term frequencies first, then apply the signed hashing trick with
	// sublinear TF weighting so a repeated term does not dominate the vector.
	const termFrequencies = new Map<string, number>();
	for (const token of tokens) {
		termFrequencies.set(token, (termFrequencies.get(token) ?? 0) + 1);
	}

	// A typed array both avoids `number | undefined` index typing under
	// noUncheckedIndexedAccess and is faster for a fixed-size numeric buffer.
	const vector = new Float64Array(BASELINE_EMBEDDING_DIM);
	for (const [token, count] of termFrequencies) {
		const hash = fnv1a(token);
		const bucket = hash % BASELINE_EMBEDDING_DIM;
		// A bit of the same hash gives a stable ±1 sign, so colliding tokens tend to
		// cancel rather than always reinforce (reduces hash-collision bias).
		const sign = ((hash >>> 16) & 1) === 0 ? 1 : -1;
		vector[bucket] = (vector[bucket] ?? 0) + sign * (1 + Math.log(count));
	}

	// L2-normalize so a dot product is a cosine similarity (001 FR-019).
	let sumOfSquares = 0;
	for (const value of vector) {
		sumOfSquares += value * value;
	}
	const norm = Math.sqrt(sumOfSquares);
	if (norm > 0) {
		for (let i = 0; i < vector.length; i++) {
			vector[i] = (vector[i] ?? 0) / norm;
		}
	}

	return {
		embedding: Array.from(vector),
		embeddingModel: BASELINE_EMBEDDING_MODEL,
		embeddingSource: 'local',
	};
}
