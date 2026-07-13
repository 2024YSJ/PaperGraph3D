import type { Paper, PaperSourceId } from '../models/paper';
import type { PaperStore } from '../persistence/store';
import type { ConcurrencyGuard } from './concurrencyGuard';
import type { BulkRefreshResult, EmbeddingConfig, RefreshHooks } from './types';
import { fetchArxivEntriesByIds } from '../collection/arxivClient';
import { fetchSemanticScholarBatch } from '../collection/semanticScholarClient';
import { parseSemanticScholarPaper, toPaperSourceId } from '../collection/semanticScholarParser';
import { refreshOne } from './refreshOne';

// A run this large is confirmed with the caller first (when a confirmLargeRun hook is
// supplied) before any provider call is made — even with both provider lookups now
// batched (FR-015/FR-018), a run of this size still means hundreds of individual
// per-paper writes (embedding recompute, store I/O) and is worth a heads-up.
const BULK_LARGE_RUN_THRESHOLD = 300;

type CitationOverride = { citationCount: number; references: PaperSourceId[] } | 'unavailable';
type ContentOverride = { status: 'found'; entry: Element } | { status: 'notFound' } | { status: 'error'; message: string };

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
	// Asked once, before any provider call, only when the matched set exceeds
	// BULK_LARGE_RUN_THRESHOLD. Absent (008 not yet wired) or resolving true proceeds
	// unconditionally, preserving today's behavior; resolving false declines the run
	// with no provider call made and no papers touched.
	confirmLargeRun?: (matchedCount: number) => Promise<boolean>,
): Promise<BulkRefreshResult | { status: 'alreadyRunning' } | { status: 'declinedLargeRun' }> {
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

		if (matched.length > BULK_LARGE_RUN_THRESHOLD && confirmLargeRun !== undefined) {
			const proceed = await confirmLargeRun(matched.length);
			if (!proceed) {
				return { status: 'declinedLargeRun' };
			}
		}

		// FR-018: one batched citation lookup for the whole matched set (chunked to 500
		// ids/request inside the client), never one call per paper. Missing/failed
		// elements become 'unavailable' so their citation fields carry through (FR-021).
		const citationOverrides = new Map<PaperSourceId, CitationOverride>();
		const s2Batch = await fetchSemanticScholarBatch(
			matched.map((paper) => baseId(paper.sourceId)),
			getSemanticScholarApiKey(),
		);
		for (let index = 0; index < matched.length; index += 1) {
			const element = s2Batch[index];
			if (element !== undefined && element !== null && 'body' in element) {
				const parsed = parseSemanticScholarPaper(element.body);
				citationOverrides.set(matched[index]!.sourceId, {
					citationCount: parsed.citationCount,
					references: parsed.references.map(toPaperSourceId),
				});
			} else {
				citationOverrides.set(matched[index]!.sourceId, 'unavailable');
			}
		}

		// FR-015 (corrected, research.md Decision 4): one batched arXiv content re-fetch
		// for the whole matched set — arXiv's `id_list=` accepts a comma-separated list,
		// so this is the same batch-lookup treatment already given to the Semantic
		// Scholar citation lookup above, not one HTTP call per paper. A chunk that fails
		// (throttled/malformed) surfaces as a per-paper 'error' override rather than
		// retrying individually, which would reintroduce the storm batching avoids.
		const contentOverrides = new Map<PaperSourceId, ContentOverride>();
		const { found, failedIds } = await fetchArxivEntriesByIds(matched.map((paper) => baseId(paper.sourceId)));
		for (const paper of matched) {
			const id = baseId(paper.sourceId);
			if (failedIds.has(id)) {
				contentOverrides.set(paper.sourceId, { status: 'error', message: 'arXiv batch content lookup failed for this paper' });
				continue;
			}
			const entry = found.get(id);
			if (entry === undefined) {
				contentOverrides.set(paper.sourceId, { status: 'notFound' });
				continue;
			}
			contentOverrides.set(paper.sourceId, { status: 'found', entry });
		}

		// Sequential per-paper loop (FR-010). Both provider lookups are already batched
		// above, so each iteration here does purely local work (apply overrides, recompute
		// embedding, persist) — no per-paper network pacing is needed.
		const failures: { sourceId: PaperSourceId; reason: string }[] = [];
		let done = 0;

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

			try {
				const outcome = await refreshOne(
					store,
					sourceId,
					guard,
					hooks,
					isSummarizationEnabled,
					getSemanticScholarApiKey,
					getEmbeddingConfig,
					{
						alreadyClaimed: true,
						citationOverride: citationOverrides.get(sourceId),
						contentOverride: contentOverrides.get(sourceId),
					},
				);
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

			// FR-022: cancellation is checked AFTER the just-finished paper settled and
			// BEFORE the next one starts, so the in-flight paper is never interrupted
			// mid-write and no further paper is touched (research.md Decision 12).
			if (guard.isBulkCancelRequested()) {
				break;
			}
		}

		return { matchedCount: done, failures };
	} finally {
		// Releasing the bulk guard also clears any pending cancel flag, so a fresh run (or
		// a single-paper refresh) can start immediately (FR-022).
		guard.releaseBulk();
	}
}
