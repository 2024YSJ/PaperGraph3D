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
		// Defensive alignment guard. The batch client already keeps results positionally
		// aligned to the input ids and pads missing/short positions with null (see
		// semanticScholarClient § batch contract), so a "99 of 100 found" response can never
		// shift later candidates. This guards the one remaining assumption — that the S2
		// endpoint does not REORDER within a batch — by confirming the returned record's own
		// arXiv id echoes the candidate we asked about. On a positive mismatch we refuse the
		// data rather than let one paper's references attach to another: the candidate is left
		// un-enriched (citationsKnown stays false) and 005's per-paper refresh (single GET, no
		// batch alignment) corrects it later. Only checked for arXiv-scheme candidates; a
		// record with no echoed arXiv id can't prove a mismatch, so it is trusted as before.
		const expectedArxivId = candidate.sourceId.startsWith(ARXIV_PREFIX)
			? candidate.sourceId.slice(ARXIV_PREFIX.length)
			: undefined;
		if (
			expectedArxivId !== undefined &&
			paper.arxivId !== undefined &&
			paper.arxivId !== expectedArxivId
		) {
			outcomes.set(candidate.sourceId, { status: 'transientFailure' });
			continue;
		}
		outcomes.set(candidate.sourceId, {
			status: 'enriched',
			citationCount: paper.citationCount,
			references: paper.references.map(toPaperSourceId),
		});
	}

	return outcomes;
}
