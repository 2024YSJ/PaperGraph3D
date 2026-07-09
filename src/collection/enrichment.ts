import type { PaperCandidate, PaperSourceId } from '../models/paper';
import type { EnrichmentOutcome } from './types';
import { fetchSemanticScholarBatch } from './semanticScholarClient';
import { parseSemanticScholarPaper, toPaperSourceId } from './semanticScholarParser';

export type { EnrichmentOutcome } from './types';

const ARXIV_PREFIX = 'arxiv:';

// Batch citation enrichment (research.md Decision 33): one outcome per candidate, keyed by
// sourceId. Identity is arXiv-ID only, extracted from candidate.sourceId. See
// contracts/collection-pipeline.md § enrichment.ts.
export async function enrichFromSemanticScholar(
	candidates: PaperCandidate[],
	apiKey: string | undefined,
): Promise<Map<PaperSourceId, EnrichmentOutcome>> {
	const outcomes = new Map<PaperSourceId, EnrichmentOutcome>();
	if (candidates.length === 0) {
		return outcomes;
	}

	const arxivIds = candidates.map((candidate) =>
		candidate.sourceId.startsWith(ARXIV_PREFIX)
			? candidate.sourceId.slice(ARXIV_PREFIX.length)
			: candidate.sourceId,
	);
	const batch = await fetchSemanticScholarBatch(arxivIds, apiKey);

	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index]!;
		const element = batch[index];
		if (element === null || element === undefined) {
			outcomes.set(candidate.sourceId, { status: 'terminalAbsence' });
			continue;
		}
		if ('status' in element) {
			// 429 / networkError placeholder — a transient failure this pass.
			outcomes.set(candidate.sourceId, { status: 'transientFailure' });
			continue;
		}
		const paper = parseSemanticScholarPaper(element.body);
		outcomes.set(candidate.sourceId, {
			status: 'enriched',
			citationCount: paper.citationCount,
			references: paper.references.map(toPaperSourceId),
		});
	}

	return outcomes;
}
