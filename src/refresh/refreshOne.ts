import type { Paper, PaperSourceId } from '../models/paper';
import type { PaperStore } from '../persistence/store';
import type { ConcurrencyGuard } from './concurrencyGuard';
import type { EmbeddingConfig, RefreshHooks, RefreshOutcome } from './types';
import { fetchArxivEntryById } from '../collection/arxivClient';
import { parseArxivEntry } from '../collection/arxivParser';
import { fetchSemanticScholarPaper } from '../collection/semanticScholarClient';
import { parseSemanticScholarPaper, toPaperSourceId } from '../collection/semanticScholarParser';
import { computeCanonicalEmbedding } from './embeddingRecompute';
import { shouldRegenerateSummary } from './summaryTrigger';

// A stored sourceId is `${provider}:${localPart}`; the arXiv/Semantic Scholar clients
// both take the bare, version-stripped local id (arXiv ids are already version-stripped
// at collection time, per 002). Take everything after the first ':' .
function baseId(sourceId: PaperSourceId): string {
	return sourceId.slice(sourceId.indexOf(':') + 1);
}

// Single-paper refresh (FR-001–FR-006, FR-013, FR-014, FR-017, FR-019, FR-020, FR-021).
// Also the per-paper unit bulkRefresh.ts calls for each matched paper (via
// `alreadyClaimed`/`citationOverride`). Returns a RefreshOutcome; the record/note
// pairing is never left partially updated — a failed content call keeps the stored
// data untouched (FR-005), a Semantic Scholar-only failure still applies content
// (FR-021).
export async function refreshOne(
	store: PaperStore,
	sourceId: PaperSourceId,
	guard: ConcurrencyGuard,
	hooks: RefreshHooks,
	isSummarizationEnabled: () => boolean,
	getSemanticScholarApiKey: () => string | undefined,
	getEmbeddingConfig: () => EmbeddingConfig,
	options?: {
		alreadyClaimed?: boolean;
		citationOverride?: { citationCount: number; references: PaperSourceId[] } | 'unavailable';
	},
): Promise<RefreshOutcome> {
	// Step 0: a sourceId absent from the store fails immediately, before any provider
	// call and before claiming the guard — refresh only ever targets an already-saved
	// paper (FR-021, 2026-07-10 Clarification).
	const stored = await store.get(sourceId);
	if (stored === undefined) {
		return { status: 'notFound' };
	}

	// Step 1: claim the guard, unless bulk already claimed this paper via claimForBulkItem.
	const alreadyClaimed = options?.alreadyClaimed === true;
	if (!alreadyClaimed && !guard.claimSingle(sourceId)) {
		return { status: 'alreadyInFlight' };
	}

	try {
		// Step 2: arXiv content re-fetch. A thrown/timed-out call is FR-005's "existing
		// data kept, user informed" -> 'error'; a missing entry is 'notFound'. Either way
		// nothing is written, so the stored pairing is untouched.
		let entry: Element | undefined;
		try {
			entry = await fetchArxivEntryById(baseId(sourceId));
		} catch (err) {
			return { status: 'error', message: messageOf(err) };
		}
		if (entry === undefined) {
			return { status: 'notFound' };
		}
		const candidate = parseArxivEntry(entry);
		if (candidate === undefined) {
			return { status: 'notFound' };
		}

		// Title/abstract/authors are overwritten unconditionally with whatever arXiv
		// returns now — no version comparison (FR-013). publicationYear and sourceId are
		// NEVER taken from the re-fetched entry: the stored publicationYear is the FR-009
		// window key and must stay stable (FR-002); an unparseable re-fetched year
		// (`candidate.publicationYear` may be undefined) never overwrites it or fails the
		// refresh.
		const freshTitle = candidate.title;
		const freshAbstract = candidate.abstract;
		const freshAuthors = candidate.authors;

		// Step 3: citation lookup. Bulk supplies a pre-fetched batch result via
		// citationOverride; single mode calls the per-paper endpoint. A failure/no-record
		// is NOT an abort (FR-021) — citationCount/references/citationsKnown are carried
		// through from the previously-stored Paper unchanged.
		let citationCount = stored.citationCount;
		let references = stored.references;
		let citationsKnown = stored.citationsKnown;
		const override = options?.citationOverride;
		if (override !== undefined) {
			if (override !== 'unavailable') {
				citationCount = override.citationCount;
				references = override.references;
				citationsKnown = true;
			}
		} else {
			const result = await fetchSemanticScholarPaper(baseId(sourceId), getSemanticScholarApiKey());
			if (result.status === 200) {
				const parsed = parseSemanticScholarPaper(result.body);
				citationCount = parsed.citationCount;
				references = parsed.references.map(toPaperSourceId);
				citationsKnown = true;
			}
		}

		// Step 4: build the updated Paper — stored spread first so publicationYear and
		// sourceId carry through unchanged (FR-002/FR-004).
		const updated: Paper = {
			...stored,
			title: freshTitle,
			abstract: freshAbstract,
			authors: freshAuthors,
			citationCount,
			references,
			citationsKnown,
		};

		// Step 5: recompute the content embedding iff title or abstract changed (FR-019),
		// via 002's canonical-provider logic (read live). Unchanged content carries the
		// stored embedding fields through unmodified.
		const contentChanged = freshTitle !== stored.title || freshAbstract !== stored.abstract;
		if (contentChanged) {
			const computed = await computeCanonicalEmbedding(freshTitle, freshAbstract, getEmbeddingConfig());
			updated.embedding = computed.embedding;
			updated.embeddingModel = computed.embeddingModel;
			updated.embeddingSource = computed.embeddingSource;
		}

		// Step 6/7: regenerate the 004 summary/future-directions text when the abstract
		// changed OR the effective uncited status flipped (FR-014 ∨ FR-020) — but only
		// when summarization is enabled (read live). An undefined summary/futureDirections
		// preserves whatever is stored (003 field-scoped merge), so a non-regenerating
		// refresh, or a disabled setting, leaves the existing summary as-is.
		let summary: string | undefined;
		let futureDirections: string | undefined;
		const regenerate = shouldRegenerateSummary(stored, {
			abstract: freshAbstract,
			citationCount,
			citationsKnown,
		});
		if (regenerate && isSummarizationEnabled() && hooks.summarize !== undefined) {
			const generated = await hooks.summarize({
				title: freshTitle,
				abstract: freshAbstract,
				citationCount,
				citationsKnown,
			});
			// 004 cannot detect a mid-flight settings change, so re-read live after it
			// resolves and discard a stale result if summarization was turned off during
			// the call (FR-014 in-flight-discard, mirroring 002 FR-021).
			if (generated !== undefined && isSummarizationEnabled()) {
				summary = generated.summary;
				futureDirections = generated.futureDirections;
			}
		}

		// Step 8: persist through 003's existing pairing — targets only this sourceId, so
		// no other paper is read or written (FR-003/FR-004). The user's note body is
		// preserved by the store's own merge.
		await store.upsert({ paper: updated, summary, futureDirections });
		return { status: 'updated' };
	} catch (err) {
		// Any unexpected failure (e.g. a persist I/O error) keeps the guard from leaking
		// and surfaces as 'error' rather than a partially-updated pairing (FR-005).
		return { status: 'error', message: messageOf(err) };
	} finally {
		if (!alreadyClaimed) {
			guard.releaseSingle(sourceId);
		}
	}
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
