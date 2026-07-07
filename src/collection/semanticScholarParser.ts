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
			references.push({
				arxivId: readArxivId(reference.externalIds),
				semanticScholarId: typeof reference.paperId === 'string' ? reference.paperId : '',
			});
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
