import type { SummarizationInput } from '../../collection/pipeline';

// This feature's own internal provider abstraction (research.md §4).
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
	| 'rate-limited'
	| 'empty-or-too-short'
	| 'provider-error';

export type GenerationOutcome =
	| { ok: true; summary: string; futureDirections: string }
	| { ok: false; reason: GenerationFailureReason };
