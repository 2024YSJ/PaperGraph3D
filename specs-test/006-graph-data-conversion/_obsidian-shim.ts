// Minimal 'obsidian' stub for the 006 spec-test (not itself a test). 006's conversion
// transitively imports the canonical-space constants (SPECTER2_EMBEDDING_MODEL /
// SPECTER2_EMBEDDING_DIM) from src/collection/localTransformer → modelAssets, and
// modelAssets imports `requestUrl` from 'obsidian'. Conversion performs NO download or
// network request, so requestUrl is a never-called stub; no network is touched.
export function requestUrl(): never {
	throw new Error('006 graph conversion must not perform any network request');
}

export type DataAdapter = unknown;
