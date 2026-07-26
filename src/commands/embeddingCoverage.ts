import type { EmbeddingFailureReason, Paper } from '../models/paper';
import { BASELINE_EMBEDDING_MODEL } from '../collection/embedding';
import { SPECTER2_EMBEDDING_MODEL } from '../collection/localTransformer';

// How much of the persisted corpus actually sits in the canonical embedding space.
//
// This is the question the graph feature cares about and the one that had no answer:
// only papers sharing the canonical space can be projected together (001 FR-020), so a
// corpus that is half baseline vectors produces a graph that looks fine while placing
// half its nodes meaninglessly. Counting by embeddingModel is the only honest measure —
// a paper carrying a vector is not the same as a paper carrying a usable one.

export interface CoverageReport {
	total: number;
	/** In the canonical SPECTER2 space — the only papers the graph can truly place. */
	canonical: number;
	/** Carrying the lexical baseline: collected before the model was installed. */
	baseline: number;
	/** No vector at all, awaiting a re-embed. */
	pending: number;
	/** Papers with a recorded embedding failure, by reason. */
	failures: Partial<Record<EmbeddingFailureReason, number>>;
	/** Total papers carrying a failure record, however they are otherwise counted. */
	failed: number;
	/** Some other model id — should be empty; a non-zero count means space drift. */
	foreign: number;
}

export interface CoverageSource {
	all(): AsyncIterable<Paper>;
}

export async function measureEmbeddingCoverage(store: CoverageSource): Promise<CoverageReport> {
	const report: CoverageReport = {
		total: 0,
		canonical: 0,
		baseline: 0,
		pending: 0,
		failures: {},
		failed: 0,
		foreign: 0,
	};

	for await (const paper of store.all()) {
		report.total += 1;

		if (paper.embeddingModel === SPECTER2_EMBEDDING_MODEL) {
			report.canonical += 1;
		} else if (paper.embeddingModel === BASELINE_EMBEDDING_MODEL) {
			report.baseline += 1;
		} else if (paper.embeddingModel === null) {
			report.pending += 1;
		} else {
			report.foreign += 1;
		}

		// Counted independently of the space buckets: a paper can carry a stale canonical
		// vector AND a failure from a later attempt, and both facts matter.
		const failure = paper.embeddingFailure;
		if (failure !== null) {
			report.failed += 1;
			report.failures[failure.reason] = (report.failures[failure.reason] ?? 0) + 1;
		}
	}

	return report;
}

/** User-facing summary. English-only per the constitution's Principle V. */
export function describeCoverage(report: CoverageReport): string {
	if (report.total === 0) {
		return 'No papers collected yet — nothing to measure.';
	}

	const percent = Math.round((report.canonical / report.total) * 100);
	const parts = [`${report.canonical}/${report.total} papers (${percent}%) are in the graph embedding space`];

	if (report.baseline > 0) {
		parts.push(`${report.baseline} still on the pre-install baseline`);
	}
	if (report.pending > 0) {
		parts.push(`${report.pending} pending`);
	}
	if (report.foreign > 0) {
		parts.push(`${report.foreign} in an unrecognized space`);
	}
	if (report.failed > 0) {
		const reasons = Object.entries(report.failures)
			.map(([reason, count]) => `${count} ${reason}`)
			.join(', ');
		parts.push(`${report.failed} with a recorded failure (${reasons})`);
	}

	return `${parts.join('; ')}.`;
}
