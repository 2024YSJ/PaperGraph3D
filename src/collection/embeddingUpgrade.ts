import type { EmbeddingFailure } from '../models/paper';
import type { EmbeddingResult } from './embedding';
import { classifyInferenceError, specter2Embedding } from './localTransformer';
import type { LocalModelLocation } from './modelAssets';

// Where the on-device model lives, read per paper so that assets arriving mid-batch
// take effect for later papers (mirrors summarization's live read, 002 FR-021).
//
// There is no provider selector any more (001 FR-022 superseded): the canonical
// embedding space is always SPECTER2. A user-chosen provider meant a user-chosen
// dimensionality, and only vectors sharing one space can be projected together by the
// graph feature (001 FR-020) — so the choice was never really available to make.
export interface EmbeddingConfig {
	/** Absent until the user has downloaded the model (modelAssets.ts). */
	location?: LocalModelLocation;
}

// The three outcomes, kept apart on purpose.
//
// This used to be `EmbeddingResult | undefined`, which collapsed 'unavailable' and
// 'failed' into one value. They call for opposite responses: 'unavailable' is the
// expected state before the user installs the model and the lexical baseline is the
// right answer (002 FR-044), whereas 'failed' means the runtime broke and the baseline
// is a downgrade nobody asked for. Merging them is what let a dead embedding runtime
// quietly fill a corpus with baseline vectors that no one could tell apart from
// intentional ones.
export type EmbeddingUpgrade =
	| { status: 'ok'; result: EmbeddingResult }
	| { status: 'unavailable' }
	| { status: 'failed'; failure: EmbeddingFailure };

// Consecutive failures after which a pass stops calling the runtime.
//
// Every attempt now rebuilds the session on failure, so without a breaker one dead
// runtime would be torn down and rebuilt once per paper for the rest of the corpus —
// minutes of thrashing to produce nothing. Three tolerates a transient fault (a single
// pathological abstract, a momentary allocation spike) while catching a real one fast.
const FAILURE_LIMIT = 3;

// Keep the stored detail short: it lands in every affected paper's JSON record, and a
// runtime stack trace would bloat the corpus without telling the user more.
const MAX_DETAIL_LENGTH = 300;

/**
 * Per-pass failure tracking for the circuit breaker. Scoped to one collection or
 * re-embed pass rather than module-global, so a later pass always gets a fresh attempt
 * — a runtime that failed under one batch may be perfectly healthy for the next.
 */
export interface EmbeddingAttempts {
	consecutiveFailures: number;
	lastFailure?: EmbeddingFailure;
}

export function createEmbeddingAttempts(): EmbeddingAttempts {
	return { consecutiveFailures: 0 };
}

/** True once the runtime has failed enough times that this pass has stopped trying. */
export function hasTripped(attempts: EmbeddingAttempts): boolean {
	return attempts.consecutiveFailures >= FAILURE_LIMIT;
}

function toFailure(error: unknown): EmbeddingFailure {
	const message = error instanceof Error ? error.message : String(error);
	return {
		reason: classifyInferenceError(error),
		detail: message.slice(0, MAX_DETAIL_LENGTH),
		at: Date.now(),
	};
}

/**
 * Attempt the canonical SPECTER2 embedding (002 FR-045). Never throws — the outcome is
 * in the return value, and every caller must handle all three cases. Pass `attempts` to
 * share one circuit breaker across a whole pass.
 */
export async function upgradeEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
	attempts?: EmbeddingAttempts,
): Promise<EmbeddingUpgrade> {
	const location = config.location;
	if (location === undefined) {
		return { status: 'unavailable' };
	}

	// Already tripped: report the failure that tripped it instead of paying for another
	// session rebuild that will fail the same way.
	if (attempts !== undefined && hasTripped(attempts) && attempts.lastFailure !== undefined) {
		return { status: 'failed', failure: attempts.lastFailure };
	}

	try {
		const result = await specter2Embedding(title, abstract, location);
		if (attempts !== undefined) {
			// Consecutive, not cumulative — one success means the runtime is working.
			attempts.consecutiveFailures = 0;
			attempts.lastFailure = undefined;
		}
		return { status: 'ok', result };
	} catch (error) {
		const failure = toFailure(error);
		if (attempts !== undefined) {
			attempts.consecutiveFailures += 1;
			attempts.lastFailure = failure;
		}
		return { status: 'failed', failure };
	}
}
