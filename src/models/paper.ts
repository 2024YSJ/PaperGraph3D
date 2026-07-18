// Single source of truth for recognized providers: the SourceProvider type is
// derived from this array, so adding a provider here (FR-016) extends both the
// compile-time union and the runtime check in isPaperSourceId() with one edit —
// they can never drift out of sync.
const SOURCE_PROVIDERS = ['arxiv', 'semanticScholar'] as const;

export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export type PaperSourceId = `${SourceProvider}:${string}`;

// Recognized content-embedding provenance values, derived from this array the
// same way SourceProvider is derived from SOURCE_PROVIDERS, so the runtime check
// in isValidPaper() and the compile-time union never drift out of sync (FR-020).
//
// Only 'local' remains: embeddings are computed on-device and nothing else can
// produce them (the 'llm' provider is retired). Kept as a union rather than dropped
// so the stored field keeps saying where a vector came from — and so a future
// provenance stays an additive change. persistence/record.ts's migrate() resets
// legacy 'llm' vectors to pending before validation ever sees them.
const EMBEDDING_SOURCES = ['local'] as const;

export type EmbeddingSource = (typeof EMBEDDING_SOURCES)[number];

export interface PaperCandidate {
	title: string;
	publicationYear: number | undefined;
	// Full publication date at month/day precision, ISO `YYYY-MM-DD` (UTC), when the
	// provider supplies a full timestamp (e.g. arXiv's `<published>`). `undefined` when
	// only a bare year is known. Additive to `publicationYear` (FR-016): the year field
	// stays the required hold-back/graph-axis key; the date only adds finer precision.
	publicationDate: string | undefined;
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
	// Content embedding: an L2-normalized numeric vector over title + abstract
	// (001 FR-019), plus its model/provenance metadata (FR-020). `undefined` on a
	// candidate means "not computed yet" — the baseline vector is produced locally
	// by collection (260702-002) at promotion, optionally upgraded to an LLM vector
	// by 260702-004. Never a hold-back trigger (FR-021): toPaper() defaults an
	// undefined embedding to null (pending) rather than holding the paper back.
	embedding: number[] | undefined;
	embeddingModel: string | undefined;
	embeddingSource: EmbeddingSource | undefined;
}

export interface Paper {
	title: string;
	publicationYear: number;
	// Month/day-precision publication date, ISO `YYYY-MM-DD` (UTC), or `undefined` when
	// only the year is known. Additive to the required `publicationYear` (which remains
	// the graph z-axis / 005 window / hold-back key). See PaperCandidate.publicationDate.
	publicationDate: string | undefined;
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
	// The subscription(s) that collected this paper: a de-duplicated set of
	// subscriptionKey() strings (models/subscription.ts) — the stable,
	// order-independent condition-set identity, not the mutable label. A single paper
	// may match several subscriptions, so this is a set: the collection pipeline stamps
	// the first collecting subscription's key here and unions any later ones (see
	// pipeline.ts recordCollectedVia / persistence mergePaper). Empty on a paper that
	// predates this field (migrate() defaults it to []) — never a hold-back trigger.
	collectedVia: string[];
	// See PaperCandidate above. On a valid Paper these keys are always present;
	// `null` means "pending" (not yet embedded) — still valid, never a hold-back
	// trigger (001 FR-019/FR-021). Only papers sharing one embeddingModel space may
	// be projected together by the graph feature (260702-006), so switching provider
	// requires re-embedding the corpus.
	embedding: number[] | null;
	embeddingModel: string | null;
	embeddingSource: EmbeddingSource | null;
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
		// Subscription provenance is stamped by the collection pipeline, which knows
		// the subscription; promotion is subscription-agnostic, so it starts empty.
		collectedVia: [],
		// An unknown embedding is defaulted to null (pending), not held back
		// (FR-021) — the baseline vector is filled by 260702-002/004.
		embedding: candidate.embedding ?? null,
		embeddingModel: candidate.embeddingModel ?? null,
		embeddingSource: candidate.embeddingSource ?? null,
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
		// Optional month/day precision: absent, or an ISO `YYYY-MM-DD` string.
		(candidate.publicationDate === undefined ||
			(typeof candidate.publicationDate === 'string' &&
				/^\d{4}-\d{2}-\d{2}$/.test(candidate.publicationDate))) &&
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
		) &&
		// Subscription provenance (this feature): a set of subscriptionKey strings.
		// An empty array is valid (a migrated pre-existing record, or a paper not
		// produced by subscription collection).
		Array.isArray(candidate.collectedVia) &&
		candidate.collectedVia.every((s) => typeof s === 'string') &&
		// Content embedding (FR-019/FR-020): the keys must be present, but a pending
		// (null) embedding is valid — it is never a hold-back trigger (FR-021).
		(candidate.embedding === null ||
			(Array.isArray(candidate.embedding) &&
				candidate.embedding.every(
					(n) => typeof n === 'number' && Number.isFinite(n),
				))) &&
		(candidate.embeddingModel === null ||
			typeof candidate.embeddingModel === 'string') &&
		(candidate.embeddingSource === null ||
			(typeof candidate.embeddingSource === 'string' &&
				(EMBEDDING_SOURCES as readonly string[]).includes(
					candidate.embeddingSource,
				)))
	);
}
