// Shared tuning constants for both the summarization and LLM-embedding halves of
// this feature (research.md §5/§11).

// Bounds every provider call (generate.ts's runGeneration/runEmbeddingGeneration)
// so a slow or hung provider can never stall collection (FR-007/FR-012).
export const GENERATION_TIMEOUT_MS = 20_000;

// A generated summary/futureDirections string shorter than this (after trimming)
// is treated as empty-or-too-short and triggers the abstract fallback (FR-007) /
// the futureDirections '' degrade (research.md §2/§5). Applied to summary
// unconditionally and to futureDirections only when one was requested.
export const MIN_GENERATED_TEXT_LENGTH = 20;

// The embeddingModel prefix contract 002's already-merged src/collection/reembed.ts
// isCanonical() depends on (`case 'llm': return model.startsWith('llm:');`,
// data-model.md §5) — binding, not a 004 design choice.
export function llmEmbeddingModelId(modelId: string, dimension: number): string {
	return `llm:${modelId}:d${dimension}`;
}

// Settings-UI disclosure copy (constitution Principle IV — non-negotiable data
// path). Authored here for 008 to place in the summarization settings section;
// 004 does not build any settings UI itself. English source strings only
// (constitution Principle V — bilingual-UX obligations for user-facing Notice
// copy are met by hook.ts's/main.ts's Notice text, mirrored on the Korean+English
// pattern already used by main.ts's subscription-failure notices; this settings
// copy is written text placed by 008, not a runtime Notice).
export const SUMMARIZATION_DISCLOSURE_COPY = {
	whatIsSent:
		'When enabled, only each paper\'s title and abstract are sent to the ' +
		'configured summarization provider — never the full record, references, or ' +
		'any other paper\'s data.',
	embeddingWhatIsSent:
		'When the LLM embedding upgrade is enabled, only each paper\'s title and ' +
		'abstract are sent to the configured embedding provider, to compute a ' +
		'content-similarity vector — the same data-minimization rule as summarization.',
	credentialStorage:
		'API credentials are stored in plaintext in this plugin\'s settings data, the ' +
		'same as the existing Semantic Scholar API key field — do not use a credential ' +
		'you would not want stored unencrypted on disk.',
} as const;
