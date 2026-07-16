import type { SummarizationInput } from '../../collection/pipeline';
import { GENERATION_TIMEOUT_MS, MIN_GENERATED_TEXT_LENGTH } from './constants';
import type {
	GenerationFailureReason,
	GenerationOutcome,
	SummarizationProvider,
} from './types';

// Internal to hook.ts — never exposed further (data-model.md §2). Never throws;
// every provider-call rejection is caught and classified into a typed failure
// reason instead.

function isTooShort(text: string): boolean {
	return text.trim().length < MIN_GENERATED_TEXT_LENGTH;
}

// Races a provider call against GENERATION_TIMEOUT_MS, aborting the shared
// AbortSignal on timeout (research.md §11). Obsidian's requestUrl has no native
// cancellation, so the in-flight request itself may continue in the background —
// this race only stops this call from waiting on it, which is sufficient since
// FR-007/FR-012 require never blocking, not necessarily severing the socket.
async function withTimeout<T>(
	run: (signal: AbortSignal) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; timedOut: true }> {
	const controller = new AbortController();
	// Explicitly `number`, not ReturnType<typeof window.setTimeout> — @types/node's
	// ambient setTimeout overload otherwise gets picked up here, which returns
	// NodeJS.Timeout and conflicts with window.setTimeout's actual `number` return
	// (the same window.setTimeout/window.clearTimeout pairing already used by
	// reembed.ts/arxivClient.ts/scheduler.ts/pipeline.ts/semanticScholarClient.ts).
	let timer: number | undefined;

	const timeout = new Promise<{ ok: false; timedOut: true }>((resolve) => {
		timer = window.setTimeout(() => {
			controller.abort();
			resolve({ ok: false, timedOut: true });
		}, GENERATION_TIMEOUT_MS);
	});

	try {
		const value = await Promise.race([
			run(controller.signal).then((v) => ({ ok: true as const, value: v })),
			timeout,
		]);
		return value;
	} finally {
		if (timer !== undefined) {
			window.clearTimeout(timer);
		}
	}
}

// A best-effort, provider-agnostic classification of a rejection into a
// non-timeout failure reason. Providers surface an invalid-credentials rejection
// via an Error whose message contains the substring 'invalid-credentials'
// (providers/openai.ts's convention, contracts/summarization-api.md); anything
// else is a generic provider-error.
function classifyRejection(
	error: unknown,
): 'invalid-credentials' | 'provider-error' {
	if (error instanceof Error && error.message.includes('invalid-credentials')) {
		return 'invalid-credentials';
	}
	return 'provider-error';
}

export async function runGeneration(
	input: SummarizationInput,
	provider: SummarizationProvider,
	credential: string,
	wantFutureDirections: boolean,
): Promise<GenerationOutcome> {
	let raced: Awaited<ReturnType<typeof withTimeout<{ summary: string; futureDirections?: string }>>>;
	try {
		raced = await withTimeout((signal) => provider.generate(input, credential, signal));
	} catch (error) {
		const reason: GenerationFailureReason = classifyRejection(error);
		return { ok: false, reason };
	}

	if (!raced.ok) {
		return { ok: false, reason: 'timeout' };
	}

	const { summary, futureDirections } = raced.value;

	if (isTooShort(summary)) {
		return { ok: false, reason: 'empty-or-too-short' };
	}

	// futureDirections's own too-short/empty shortfall degrades only that field to
	// '', never discarding an otherwise-successful summary (research.md §2). This
	// applies only when the caller actually requested it (uncited paper) — hook.ts
	// owns that gating; this function is agnostic to isUncited.
	const resolvedFutureDirections =
		wantFutureDirections && futureDirections !== undefined && !isTooShort(futureDirections)
			? futureDirections
			: '';

	return { ok: true, summary, futureDirections: resolvedFutureDirections };
}
