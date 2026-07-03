export type SourceProvider = 'arxiv' | 'semanticScholar';

export type PaperSourceId = `${SourceProvider}:${string}`;

export interface PaperCandidate {
	title: string;
	publicationYear: number | undefined;
	authors: string[];
	citationCount: number;
	abstract: string;
	sourceId: PaperSourceId;
}

export interface Paper {
	title: string;
	publicationYear: number;
	authors: string[];
	citationCount: number;
	abstract: string;
	sourceId: PaperSourceId;
}

const SOURCE_PROVIDERS: readonly SourceProvider[] = ['arxiv', 'semanticScholar'];

export function isPaperSourceId(value: string): value is PaperSourceId {
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
		isPaperSourceId(candidate.sourceId)
	);
}
