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
	citationCount: number;
	abstract: string;
	sourceId: PaperSourceId;
	// Outbound citations: sourceIds of the papers THIS paper cites. Added as an
	// FR-016 extension of the 001 baseline (the graph-conversion feature 260702-006
	// builds directional edges A->B from A.references; citedBy is derived by
	// inverting these, never stored). Populating it is the collection/note-saving
	// features' job (260702-002/003); the shape is fixed here so they share one
	// definition. May be an empty array when no citation data is available.
	references: PaperSourceId[];
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
export function toPaper(candidate: PaperCandidate): Paper | undefined {
	if (candidate.publicationYear === undefined) {
		return undefined;
	}

	return { ...candidate, publicationYear: candidate.publicationYear };
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
