import type { LocalModelLocation } from '../collection/modelAssets';
import { classifyInferenceError, specter2Embedding } from '../collection/localTransformer';

// An in-vault check that the on-device embedding runtime survives a realistic corpus.
//
// It exists because the failure it looks for cannot be reproduced outside Obsidian:
// the runtime exhausted its WASM heap part-way through a collection — around 88 to 160
// papers, moving with the batch — and the only symptom was that every paper after that
// point quietly kept the lexical baseline. The offline suites stub the runtime, so they
// can prove the failure is handled but not that it no longer happens. This runs the
// real model against the real onnxruntime build and reports where, if anywhere, it dies.
//
// Deliberately varies the text length across the run. A novel input shape per paper was
// the whole cause — onnxruntime-web plans memory per shape and its WASM heap only grows
// — so a probe using one fixed-length string would exercise a single shape and pass
// even against the broken build. These lengths sweep the range real abstracts occupy.

/** Well past both observed failure points (~88 and ~160), so a pass is meaningful. */
const DEFAULT_SAMPLE_COUNT = 200;

/** Report every this many papers, so a long run shows progress instead of hanging. */
const PROGRESS_INTERVAL = 10;

const WORDS = [
	'transformer', 'attention', 'graph', 'embedding', 'citation', 'corpus',
	'representation', 'neural', 'inference', 'benchmark', 'retrieval', 'semantic',
	'quantized', 'projection', 'similarity', 'encoder', 'pretraining', 'evaluation',
];

// Word counts sweep 20 -> 320 and back, so consecutive papers differ and the whole
// range is covered several times over a 200-paper run.
function abstractFor(index: number): string {
	const span = 300;
	const phase = index % (span * 2);
	const wordCount = 20 + (phase < span ? phase : span * 2 - phase);
	const words: string[] = [];
	for (let i = 0; i < wordCount; i += 1) {
		words.push(WORDS[(index + i) % WORDS.length] ?? 'paper');
	}
	return `${words.join(' ')}.`;
}

/**
 * Resident set size in MB, or undefined when unavailable. Electron's renderer exposes
 * Node's `process`, which is why this is legitimate here (the plugin is isDesktopOnly)
 * — but it is read defensively so nothing depends on it existing. RSS rather than a JS
 * heap figure on purpose: the WASM heap this is watching lives outside the JS heap and
 * would not show up in one.
 */
function residentMb(): number | undefined {
	const maybe = (window as unknown as { process?: { memoryUsage?: () => { rss: number } } })
		.process;
	if (maybe?.memoryUsage === undefined) {
		return undefined;
	}
	try {
		return Math.round(maybe.memoryUsage().rss / (1024 * 1024));
	} catch {
		return undefined;
	}
}

export interface VerifyProgress {
	readonly completed: number;
	readonly total: number;
	readonly residentMb: number | undefined;
}

export interface VerifyOutcome {
	readonly succeeded: number;
	readonly total: number;
	/** 1-based index of the paper that first failed, when one did. */
	readonly failedAt?: number;
	readonly failureReason?: string;
	readonly failureDetail?: string;
	readonly elapsedMs: number;
	readonly startedMb: number | undefined;
	readonly endedMb: number | undefined;
	/** True when every vector was the right size and L2-normalized. */
	readonly vectorsWellFormed: boolean;
}

/**
 * Embed `total` synthetic papers of varying length against the real model, yielding
 * between each so Obsidian stays responsive. Stops at the first failure — the point of
 * the run is to find out whether one happens and where, not to measure a failure rate.
 */
export async function verifyEmbeddingRuntime(
	location: LocalModelLocation,
	onProgress: (progress: VerifyProgress) => void,
	total: number = DEFAULT_SAMPLE_COUNT,
): Promise<VerifyOutcome> {
	const startedAt = Date.now();
	const startedMb = residentMb();
	let succeeded = 0;
	let vectorsWellFormed = true;

	for (let i = 0; i < total; i += 1) {
		try {
			const result = await specter2Embedding(
				`Verification paper ${i + 1}`,
				abstractFor(i),
				location,
			);
			// A runtime can return a plausible-looking vector while quietly producing
			// garbage, so check the two properties everything downstream assumes: the
			// canonical dimensionality, and unit length (001 FR-019).
			const norm = Math.sqrt(result.embedding.reduce((sum, v) => sum + v * v, 0));
			if (result.embedding.length !== 768 || Math.abs(norm - 1) > 1e-3) {
				vectorsWellFormed = false;
			}
			succeeded += 1;
		} catch (error) {
			return {
				succeeded,
				total,
				failedAt: i + 1,
				failureReason: classifyInferenceError(error),
				failureDetail: (error instanceof Error ? error.message : String(error)).slice(0, 200),
				elapsedMs: Date.now() - startedAt,
				startedMb,
				endedMb: residentMb(),
				vectorsWellFormed,
			};
		}

		if ((i + 1) % PROGRESS_INTERVAL === 0 || i + 1 === total) {
			onProgress({ completed: i + 1, total, residentMb: residentMb() });
		}
		// Yield so the UI keeps painting through a run of several minutes.
		await new Promise((resolve) => window.setTimeout(resolve, 0));
	}

	return {
		succeeded,
		total,
		elapsedMs: Date.now() - startedAt,
		startedMb,
		endedMb: residentMb(),
		vectorsWellFormed,
	};
}

/** User-facing summary. English-only per the constitution's Principle V. */
export function describeOutcome(outcome: VerifyOutcome): string {
	const seconds = Math.round(outcome.elapsedMs / 1000);
	const memory =
		outcome.startedMb !== undefined && outcome.endedMb !== undefined
			? ` Memory ${outcome.startedMb} MB -> ${outcome.endedMb} MB.`
			: '';

	if (outcome.failedAt !== undefined) {
		return (
			`Embedding runtime FAILED at paper ${outcome.failedAt} of ${outcome.total} ` +
			`(${outcome.failureReason}) after ${seconds}s.${memory} ${outcome.failureDetail ?? ''}`
		);
	}
	const wellFormed = outcome.vectorsWellFormed
		? 'all vectors 768-d and normalized'
		: 'WARNING: some vectors were the wrong size or not normalized';
	return (
		`Embedding runtime OK — ${outcome.succeeded}/${outcome.total} papers embedded ` +
		`in ${seconds}s, ${wellFormed}.${memory}`
	);
}
