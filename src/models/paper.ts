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
	// (undefined) — e.g. future-directions text (004) and uncited-node
	// styling (007). toPaper() defaults it to 0 at promotion, but records
	// whether it was ever known in Paper.citationsKnown so the distinction survives
	// promotion instead of being lost (002 FR-018).
	citationCount: number | undefined;
	abstract: string;
	sourceId: PaperSourceId;
	// Outbound citations: sourceIds of the papers THIS paper cites. `undefined`
	// means "reference data not fetched yet"; an empty array means "fetched, and
	// this paper cites nothing" — the same unknown-vs-empty distinction as
	// citationCount. Added as an FR-016 extension of the 001 baseline (the
	// graph-conversion feature 006 builds directional edges A->B from
	// A.references; citedBy is derived by inverting these, never stored).
	// Populating it is the collection/note-saving features' job (002/003);
	// the shape is fixed here so they share one definition. toPaper() defaults it
	// to [] at promotion.
	references: PaperSourceId[] | undefined;
}

export interface Paper {
	title: string;
	publicationYear: number;
	authors: string[];
	citationCount: number;
	// True when citationCount/references came from a citation-aware provider (e.g.
	// Semantic Scholar): a stored citationCount of 0 then means "confirmed uncited".
	// False when the candidate was promoted WITHOUT citation data (arXiv-only, or a
	// Semantic Scholar enrichment attempt that failed): citationCount was defaulted
	// to 0 and references to [], so a stored 0 here means "unknown, NOT confirmed
	// uncited". This flag is what preserves the candidate's unknown-vs-zero
	// distinction across promotion, which toPaper()'s `?? 0` / `?? []` defaults would
	// otherwise collapse. It is what lets collection (002) persist a paper
	// IMMEDIATELY instead of holding it back over missing citation data — so under
	// windowed collection the paper never falls out of the search window and is never
	// lost — while still recording that its citations are unconfirmed. Refresh
	// (005) and any auto-heal re-enrichment target citationsKnown === false
	// papers; downstream consumers (004 future-directions, 007
	// uncited-node styling) MUST treat a false-flag 0 as un-enriched, not as a real
	// zero. (002 FR-018.)
	citationsKnown: boolean;
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

// A missing or non-finite publicationYear (undefined, or NaN/Infinity from a failed
// parse) means the paper is held back, not discarded: the caller keeps the
// PaperCandidate and may call toPaper() again once a real year is known.
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
// citationCount to 0 and unknown references to []. That default would collapse the
// unknown/zero distinction, so toPaper() also sets `citationsKnown` to record
// whether the candidate actually carried citation data (citationCount !==
// undefined) — the distinction is preserved on the Paper rather than lost.
//
// Missing citation data is therefore NOT a hold-back reason: a candidate with a
// real year but unknown citations is promoted immediately with citationCount 0 and
// citationsKnown = false, so collection (002) never has to hold it out of a
// windowed search (where a held-back paper would fall out of the window and be lost
// on the next pass). Accuracy is recovered later — enrich from a citation-aware
// provider (Semantic Scholar) before promotion when a confirmed count is needed up
// front, or let refresh (005) / auto-heal correct the citationsKnown ===
// false papers afterward. publicationYear is the ONLY hold-back trigger: it is a
// hard requirement with no sane default, so a missing year returns undefined.
export function toPaper(candidate: PaperCandidate): Paper | undefined {
	const { publicationYear } = candidate;
	if (publicationYear === undefined || !Number.isFinite(publicationYear)) {
		return undefined;
	}

	return {
		...candidate,
		publicationYear,
		citationCount: candidate.citationCount ?? 0,
		citationsKnown: candidate.citationCount !== undefined,
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
		// A real year is a finite number — reject NaN/Infinity (e.g. from a failed
		// parse), which `typeof === 'number'` would otherwise let through.
		Number.isFinite(candidate.publicationYear) &&
		Array.isArray(candidate.authors) &&
		candidate.authors.every((author) => typeof author === 'string') &&
		typeof candidate.citationCount === 'number' &&
		Number.isFinite(candidate.citationCount) &&
		candidate.citationCount >= 0 &&
		typeof candidate.citationsKnown === 'boolean' &&
		typeof candidate.abstract === 'string' &&
		typeof candidate.sourceId === 'string' &&
		isPaperSourceId(candidate.sourceId) &&
		Array.isArray(candidate.references) &&
		candidate.references.every(
			(ref) => typeof ref === 'string' && isPaperSourceId(ref),
		)
	);
}
