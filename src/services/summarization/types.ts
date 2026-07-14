import type { SummarizationInput } from '../../collection/pipeline';

// This feature's own internal provider abstraction (research.md §4). NOT the same
// as models/settings.ts's EmbeddingProvider (the 3-way category selector 002
// owns) — that name is already taken, so the embedding half of this abstraction is
// deliberately named LlmEmbeddingProvider below, never EmbeddingProvider.
export interface SummarizationProvider {
	id: string;
	generate(
		input: SummarizationInput,
		credential: string,
		signal: AbortSignal,
	): Promise<{ summary: string; futureDirections?: string }>;
}

export type GenerationFailureReason =
	| 'timeout'
	| 'invalid-credentials'
	| 'empty-or-too-short'
	| 'provider-error';

export type GenerationOutcome =
	| { ok: true; summary: string; futureDirections: string }
	| { ok: false; reason: GenerationFailureReason };

// LLM embedding provider abstraction. Deliberately named LlmEmbeddingProvider, NOT
// EmbeddingProvider — that name is already taken by models/settings.ts's 3-way
// category selector type ('bundled' | 'local-transformer' | 'llm').
export interface LlmEmbeddingProvider {
	id: string;
	embed(
		title: string,
		abstract: string,
		credential: string,
		signal: AbortSignal,
	): Promise<{ vector: number[]; model: string }>;
}

export type EmbeddingFailureReason =
	| 'timeout'
	| 'invalid-credentials'
	| 'invalid-vector'
	| 'provider-error';

export type EmbeddingOutcome =
	| { ok: true; vector: number[]; model: string }
	| { ok: false; reason: EmbeddingFailureReason };
