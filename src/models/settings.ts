export interface GraphDisplayOptions {
	layout: string;
	colorScheme: string;
}

// The explicit single embedding-provider selector (001 FR-022): the corpus's
// canonical embedding space is exactly one of these at a time. 'bundled' is the
// always-available offline default; 'local-transformer' runs a user-supplied
// on-device transformer given by `localEmbeddingModel` (002 FR-046); 'llm' uses a
// configured LLM API (004). Derived from this array so the compile-time union and
// the runtime check in isValidPluginSettings() never drift.
export const EMBEDDING_PROVIDERS = ['bundled', 'local-transformer', 'llm'] as const;

export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export interface PluginSettings {
	storageLocation: string;
	summarizationEnabled: boolean;
	graphDisplayOptions: GraphDisplayOptions;
	// Optional, absent by default (FR-020, an FR-016-style additive extension by the
	// 002 collection feature — no existing 001 field is removed or redefined, and
	// DEFAULT_PLUGIN_SETTINGS is left unchanged since the field is optional). Read by
	// src/collection/semanticScholarClient.ts, which sends it as an `x-api-key` header
	// when present and omits it entirely when undefined. Never required — enrichment
	// works without it against Semantic Scholar's shared unauthenticated pool; a key
	// only grants a dedicated rate limit.
	semanticScholarApiKey?: string;
	// Optional embedding-provider selection (001 FR-022, an FR-016-style additive
	// extension). Absent -> the bundled local baseline is canonical (the default,
	// fully offline, zero setup). DEFAULT_PLUGIN_SETTINGS is left unchanged since the
	// field is optional. The bundled baseline is ALWAYS computed as a fallback
	// regardless of this selection (002 FR-044).
	embeddingProvider?: EmbeddingProvider;
	// File path or URL of the user-supplied on-device transformer model, read only
	// when embeddingProvider === 'local-transformer' (002 FR-046). Absent otherwise.
	localEmbeddingModel?: string;
	// 004-owned (FR-006). Which SummarizationProvider.id to use for text
	// generation. Absent/undefined -> no summarization call is possible even if
	// summarizationEnabled is true (treated as "not configured", FR-008-style
	// credential-problem messaging).
	summarizationProvider?: string;
	// 004-owned (FR-006). Plaintext credential for the summarization provider
	// (constitution Principle IV — disclosed in settings UI copy).
	summarizationCredential?: string;
	// 004-owned (FR-010, spec Key Entities: "this feature owns only the LLM
	// option's key"). Plaintext credential for the LLM embedding upgrade, read by
	// main.ts's existing getEmbeddingConfig() getter and threaded into
	// EmbeddingConfig.credential. Independent of summarizationCredential (FR-011:
	// sharing is allowed, not required — a user may enter the same value in both).
	embeddingCredential?: string;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
	// Concrete, non-empty default so the plugin is usable with no setup (FR-011).
	storageLocation: 'PaperGraph3D',
	// Off until explicit opt-in, per constitution Principle IV (FR-012).
	summarizationEnabled: false,
	// Placeholder defaults, not committed decisions: the future graph-display
	// feature (007) may refine or replace these (FR-013, FR-016).
	graphDisplayOptions: {
		layout: 'force-directed',
		colorScheme: 'byPublicationYear',
	},
};

function isValidGraphDisplayOptions(value: unknown): value is GraphDisplayOptions {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.layout === 'string' && typeof candidate.colorScheme === 'string';
}

export function isValidPluginSettings(data: unknown): data is PluginSettings {
	if (typeof data !== 'object' || data === null) {
		return false;
	}

	const candidate = data as Record<string, unknown>;

	return (
		typeof candidate.storageLocation === 'string' &&
		candidate.storageLocation.length > 0 &&
		typeof candidate.summarizationEnabled === 'boolean' &&
		isValidGraphDisplayOptions(candidate.graphDisplayOptions) &&
		// Optional 002 extension: absent, or a string when present (FR-020).
		(candidate.semanticScholarApiKey === undefined ||
			typeof candidate.semanticScholarApiKey === 'string') &&
		// Optional embedding-provider selection (001 FR-022): absent, or one of the
		// recognized providers; the local-transformer model path/URL is a string.
		(candidate.embeddingProvider === undefined ||
			(typeof candidate.embeddingProvider === 'string' &&
				(EMBEDDING_PROVIDERS as readonly string[]).includes(
					candidate.embeddingProvider,
				))) &&
		(candidate.localEmbeddingModel === undefined ||
			typeof candidate.localEmbeddingModel === 'string') &&
		// Optional 004 extensions: absent, or a string when present (FR-006/FR-010).
		(candidate.summarizationProvider === undefined ||
			typeof candidate.summarizationProvider === 'string') &&
		(candidate.summarizationCredential === undefined ||
			typeof candidate.summarizationCredential === 'string') &&
		(candidate.embeddingCredential === undefined ||
			typeof candidate.embeddingCredential === 'string')
	);
}
