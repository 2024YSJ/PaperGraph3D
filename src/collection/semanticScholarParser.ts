import type { PaperSourceId } from '../models/paper';
import { stripArxivVersion } from './types';
import type { SemanticScholarPaper, SemanticScholarReference } from './types';

export type { SemanticScholarPaper, SemanticScholarReference } from './types';

// Semantic Scholar JSON -> intermediate citation shape. Every arXiv ID (the paper's own
// and each reference's) is passed through stripArxivVersion — never assumed to already
// arrive version-free from externalIds.ArXiv (research.md Decision 9/13).

function readArxivId(externalIds: unknown): string | undefined {
	if (typeof externalIds !== 'object' || externalIds === null) {
		return undefined;
	}
	const arxiv = (externalIds as Record<string, unknown>).ArXiv;
	if (typeof arxiv !== 'string' || arxiv.length === 0) {
		return undefined;
	}
	return stripArxivVersion(arxiv);
}

export function parseSemanticScholarPaper(body: unknown): SemanticScholarPaper {
	const record = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;

	const references: SemanticScholarReference[] = [];
	const rawReferences = record.references;
	if (Array.isArray(rawReferences)) {
		for (const raw of rawReferences) {
			if (typeof raw !== 'object' || raw === null) {
				continue;
			}
			const reference = raw as Record<string, unknown>;
			const arxivId = readArxivId(reference.externalIds);
			const semanticScholarId = typeof reference.paperId === 'string' ? reference.paperId : '';
			// Semantic Scholar sometimes returns a reference with no externalIds.ArXiv AND a
			// null/missing paperId (a stub record for a paper it has minimal metadata for).
			// Without either identifier, toPaperSourceId would build `semanticScholar:` with an
			// empty local part — an id 001's isPaperSourceId explicitly rejects as useless, which
			// would make the enriched paper fail isValidPaper. Skip such a reference entirely
			// rather than propagate an invalid sourceId (same "skip, don't corrupt" pattern as
			// arxivParser.ts's parseArxivEntry, research.md Decision 28).
			if ((arxivId === undefined || arxivId.length === 0) && semanticScholarId.length === 0) {
				continue;
			}
			references.push({ arxivId, semanticScholarId });
		}
	}

	return {
		paperId: typeof record.paperId === 'string' ? record.paperId : '',
		arxivId: readArxivId(record.externalIds),
		citationCount: typeof record.citationCount === 'number' && Number.isFinite(record.citationCount)
			? record.citationCount
			: 0,
		references,
	};
}

// arxiv:<id> when an arXiv id is present (already version-stripped by
// parseSemanticScholarPaper), otherwise semanticScholar:<paperId>. The single place this
// mapping happens (research.md Decision 9).
export function toPaperSourceId(reference: SemanticScholarReference): PaperSourceId {
	if (reference.arxivId !== undefined && reference.arxivId.length > 0) {
		return `arxiv:${reference.arxivId}`;
	}
	return `semanticScholar:${reference.semanticScholarId}`;
}
