import type { Paper, PaperSourceId } from '../models/paper';
import type { PaperStore } from '../persistence/store';
import type { ConcurrencyGuard } from './concurrencyGuard';
import type { BulkRefreshResult, EmbeddingConfig, RefreshHooks } from './types';
import { fetchSemanticScholarBatch } from '../collection/semanticScholarClient';
import { parseSemanticScholarPaper, toPaperSourceId } from '../collection/semanticScholarParser';
import { refreshOne } from './refreshOne';

// Bulk arXiv content-refetch pacing (FR-015, research.md Decision 4): a short fixed
// delay by default, doubling only after an observed per-paper failure (never
// pre-emptively), capped at arXiv's own 3 s baseline, and reset after a success.
const BULK_BASE_DELAY_MS = 300;
const BULK_MAX_DELAY_MS = 3_000;

type CitationOverride = { citationCount: number; references: PaperSourceId[] } | 'unavailable';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function baseId(sourceId: PaperSourceId): string {
	return sourceId.slice(sourceId.indexOf(':') + 1);
}

// Bulk refresh (FR-009–FR-012, FR-015, FR-016, FR-018, FR-019, FR-022). Selects every
// saved paper published within the last year, batch-looks-up their citation data
// through Semantic Scholar's batch endpoint ONCE, then refreshes each sequentially
// via refreshOne — pacing arXiv content re-fetches, reporting progress, summarizing
// failures without aborting, and stopping cleanly on user cancellation.
export async function runBulkRefresh(
	store: PaperStore,
	guard: ConcurrencyGuard,
	hooks: RefreshHooks,
	isSummarizationEnabled: () => boolean,
	getSemanticScholarApiKey: () => string | undefined,
	getEmbeddingConfig: () => EmbeddingConfig,
	onProgress?: (done: number, total: number) => void,
): Promise<BulkRefreshResult | { status: 'alreadyRunning' }> {
	// FR-012: a second bulk run must not start while one is active.
	if (!guard.claimBulk()) {
		return { status: 'alreadyRunning' };
	}

	try {
		// FR-009: select every stored paper with publicationYear within the last year —
		// a year-granularity comparison (publicationYear >= currentYear - 1), the coarsest
		// the bare-year field supports (research.md Decision 11). store.all() hydrates each
		// paper on demand (research.md Decision 10).
		const currentYear = new Date().getFullYear();
		const matched: Paper[] = [];
		for await (const paper of store.all()) {
			if (paper.publicationYear >= currentYear - 1) {
				matched.push(paper);
			}
		}

		// FR-018: one batched citation lookup for the whole matched set (chunked to 500
		// ids/request inside the client), never one call per paper. Missing/failed
		// elements become 'unavailable' so their citation fields carry through (FR-021).
		const overrides = new Map<PaperSourceId, CitationOverride>();
		const batch = await fetchSemanticScholarBatch(
			matched.map((paper) => baseId(paper.sourceId)),
			getSemanticScholarApiKey(),
		);
		for (let index = 0; index < matched.length; index += 1) {
			const element = batch[index];
			if (element !== undefined && element !== null && 'body' in element) {
				const parsed = parseSemanticScholarPaper(element.body);
				overrides.set(matched[index]!.sourceId, {
					citationCount: parsed.citationCount,
					references: parsed.references.map(toPaperSourceId),
				});
			} else {
				overrides.set(matched[index]!.sourceId, 'unavailable');
			}
		}

		// Paced sequential per-paper loop (FR-010/FR-015). refreshOne does the actual work
		// for each paper, given its pre-fetched citation override.
		const failures: { sourceId: PaperSourceId; reason: string }[] = [];
		let done = 0;
		let pacing = BULK_BASE_DELAY_MS;

		for (const paper of matched) {
			const sourceId = paper.sourceId;

			// FR-012: skip (do NOT count as a failure) a paper a concurrent single refresh
			// already holds — it is being refreshed anyway.
			if (!guard.claimForBulkItem(sourceId)) {
				done += 1;
				onProgress?.(done, matched.length);
				if (guard.isBulkCancelRequested()) {
					break;
				}
				continue;
			}

			let status: string;
			try {
				const outcome = await refreshOne(
					store,
					sourceId,
					guard,
					hooks,
					isSummarizationEnabled,
					getSemanticScholarApiKey,
					getEmbeddingConfig,
					{ alreadyClaimed: true, citationOverride: overrides.get(sourceId) },
				);
				status = outcome.status;
				// FR-011: a per-paper failure is recorded and summarized, never aborts.
				if (outcome.status === 'notFound') {
					failures.push({ sourceId, reason: 'notFound' });
				} else if (outcome.status === 'error') {
					failures.push({ sourceId, reason: outcome.message });
				}
			} finally {
				guard.releaseForBulkItem(sourceId);
			}

			done += 1;
			onProgress?.(done, matched.length);

			// FR-015: back off only after an actual failure; reset after a success.
			pacing = status === 'error' ? Math.min(pacing * 2, BULK_MAX_DELAY_MS) : BULK_BASE_DELAY_MS;

			// FR-022: cancellation is checked AFTER the just-finished paper settled and
			// BEFORE the next one starts, so the in-flight paper is never interrupted
			// mid-write and no further paper is touched (research.md Decision 12).
			if (guard.isBulkCancelRequested()) {
				break;
			}

			await delay(pacing);
		}

		return { matchedCount: done, failures };
	} finally {
		// Releasing the bulk guard also clears any pending cancel flag, so a fresh run (or
		// a single-paper refresh) can start immediately (FR-022).
		guard.releaseBulk();
	}
}
