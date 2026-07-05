// Single source of truth for recognized providers: the SourceProvider type is
// derived from this array, so adding a provider here (FR-016) extends both the
// compile-time union and the runtime check in isPaperSourceId() with one edit —
// they can never drift out of sync.
const SOURCE_PROVIDERS = ['arxiv', 'semanticScholar'] as const;

export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export type PaperSourceId = `${SourceProvider}:${string}`;

export interface PaperCandidate {
	title: string;
	publicationYear: number | undefined;
	authors: string[];
	// `undefined` means "not known yet" — deliberately distinct from 0 ("confirmed
	// zero citations"). arXiv returns no citation data at all, so an arXiv-only
	// candidate leaves this undefined until a citation-aware provider (e.g.
	// Semantic Scholar) fills it. Keeping unknown separate from 0 is what lets
	// downstream features tell an *uncited* paper (0) from an *un-enriched* one
	// (undefined) — e.g. future-directions text (260702-004) and uncited-node
	// styling (260702-007). toPaper() defaults it to 0 at promotion.
	citationCount: number | undefined;
	abstract: string;
	sourceId: PaperSourceId;
	// Outbound citations: sourceIds of the papers THIS paper cites. `undefined`
	// means "reference data not fetched yet"; an empty array means "fetched, and
	// this paper cites nothing" — the same unknown-vs-empty distinction as
	// citationCount. Added as an FR-016 extension of the 001 baseline (the
	// graph-conversion feature 260702-006 builds directional edges A->B from
	// A.references; citedBy is derived by inverting these, never stored).
	// Populating it is the collection/note-saving features' job (260702-002/003);
	// the shape is fixed here so they share one definition. toPaper() defaults it
	// to [] at promotion.
	references: PaperSourceId[] | undefined;
}

export interface Paper {
	title: string;
	publicationYear: number;
	authors: string[];
	citationCount: number;
	abstract: string;
	sourceId: PaperSourceId;
	// See PaperCandidate.references above — same field, carried onto the validated
	// Paper shape so every downstream feature reads citation edges from one place.
	references: PaperSourceId[];
}

export function isPaperSourceId(value: string): value is PaperSourceId {
	// Require a recognized `provider:` prefix followed by a non-empty local part.
	// separatorIndex <= 0 rejects a missing or empty provider ('foo', ':foo');
	// separatorIndex === value.length - 1 rejects a trailing colon with no local
	// part ('arxiv:'), which is stricter than the PaperSourceId template type
	// (whose `${string}` suffix would technically admit the empty string) — a
	// deliberate defensive narrowing, since an id with no local part is useless.
	const separatorIndex = value.indexOf(':');
	if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
		return false;
	}

	const provider = value.slice(0, separatorIndex);
	return (SOURCE_PROVIDERS as readonly string[]).includes(provider);
}

// A missing publicationYear means the paper is held back, not discarded: the
// caller keeps the PaperCandidate and may call toPaper() again once a year is known.
//
// This is NOT a retry mechanism for a failed API call. A failed/incomplete API
// response is the collection feature's concern (it re-calls). toPaper() only
// handles the other case: the call SUCCEEDED but the record genuinely has no
// year (e.g. an arXiv preprint), where re-calling the same provider would return
// the same missing year. The year is expected to arrive later from a different
// path (a preprint that gets published, a second provider, a metadata-enrichment
// pass), so the already-fetched fields are kept rather than re-fetched. The
// held-back candidate lives only in memory for the current collection pass; this
// module persists nothing and adds no retry queue (spec Session 2026-07-04).
//
// Promotion policy for the other candidate-only "unknown" fields: citationCount
// and references may be `undefined` ("not known yet") on a candidate, but a valid
// Paper always carries concrete values, so toPaper() defaults an unknown
// citationCount to 0 and unknown references to []. This collapses the
// unknown/zero distinction at promotion — a candidate never enriched with
// citation data becomes a Paper reading "0 citations". Callers that need true
// uncited-vs-unknown accuracy (260702-004/007) must enrich the candidate (e.g.
// via Semantic Scholar) BEFORE promoting it. publicationYear is not defaulted:
// it is a hard requirement, so a missing year holds the paper back instead.
export function toPaper(candidate: PaperCandidate): Paper | undefined {
	if (candidate.publicationYear === undefined) {
		return undefined;
	}

	return {
		...candidate,
		publicationYear: candidate.publicationYear,
		citationCount: candidate.citationCount ?? 0,
		references: candidate.references ?? [],
	};
}

export function isValidPaper(data: unknown): data is Paper {
	if (typeof data !== 'object' || data === null) {
		return false;
	}

	const candidate = data as Record<string, unknown>;

	return (
		typeof candidate.title === 'string' &&
		typeof candidate.publicationYear === 'number' &&
		Array.isArray(candidate.authors) &&
		candidate.authors.every((author) => typeof author === 'string') &&
		typeof candidate.citationCount === 'number' &&
		typeof candidate.abstract === 'string' &&
		typeof candidate.sourceId === 'string' &&
		isPaperSourceId(candidate.sourceId) &&
		Array.isArray(candidate.references) &&
		candidate.references.every(
			(ref) => typeof ref === 'string' && isPaperSourceId(ref),
		)
	);
}
