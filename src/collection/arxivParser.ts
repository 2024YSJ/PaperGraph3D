import type { PaperCandidate } from '../models/paper';
import { stripArxivVersion } from './types';

// arXiv Atom XML -> PaperCandidate (001). citationCount/references are left undefined
// ("not known yet") — arXiv carries no citation data; enrichment (Semantic Scholar) fills
// them later. See contracts/collection-pipeline.md § arxivParser.ts.

function textOf(entry: Element, tagName: string): string | undefined {
	const node = entry.getElementsByTagName(tagName)[0];
	const text = node?.textContent?.trim();
	return text !== undefined && text.length > 0 ? text : undefined;
}

function arxivBaseId(idText: string): string {
	// <id> is typically a URL like http://arxiv.org/abs/2301.12345v1 — take the abs path
	// segment (or the last path segment as a fallback), then strip the version suffix.
	const afterAbs = idText.split('/abs/')[1];
	const raw = (afterAbs ?? idText.split('/').pop() ?? idText).trim();
	return stripArxivVersion(raw);
}

// Maps a single already-parsed Atom <entry> node to a PaperCandidate, or undefined (never
// throws) when the entry is too structurally incomplete to build one — no extractable
// <id>, title, or <summary> (FR-023, research.md Decision 28). Callers filter undefined.
export function parseArxivEntry(entry: Element): PaperCandidate | undefined {
	const idText = textOf(entry, 'id');
	const title = textOf(entry, 'title');
	const abstract = textOf(entry, 'summary');
	if (idText === undefined || title === undefined || abstract === undefined) {
		return undefined;
	}

	const baseId = arxivBaseId(idText);
	if (baseId.length === 0) {
		return undefined;
	}

	const authors: string[] = [];
	const authorNodes = entry.getElementsByTagName('author');
	for (let index = 0; index < authorNodes.length; index += 1) {
		const nameNode = authorNodes[index]?.getElementsByTagName('name')[0];
		const name = nameNode?.textContent?.trim();
		if (name !== undefined && name.length > 0) {
			authors.push(name);
		}
	}

	let publicationYear: number | undefined;
	let publicationDate: string | undefined;
	const publishedText = textOf(entry, 'published');
	if (publishedText !== undefined) {
		const parsed = new Date(publishedText);
		if (Number.isFinite(parsed.getTime())) {
			publicationYear = parsed.getUTCFullYear();
			// arXiv's <published> is a full ISO timestamp; keep month/day precision as
			// UTC YYYY-MM-DD (001 publicationDate). publicationYear stays the bare year.
			publicationDate = parsed.toISOString().slice(0, 10);
		}
	}

	return {
		title,
		publicationYear,
		publicationDate,
		authors,
		citationCount: undefined,
		abstract,
		sourceId: `arxiv:${baseId}`,
		references: undefined,
		// arXiv provides no content embedding; left undefined ("not computed yet")
		// so a later embedding pass (006 graph-conversion) can populate it.
		embedding: undefined,
		embeddingModel: undefined,
		embeddingSource: undefined,
	};
}

// Convenience wrapper for a whole Atom document (quickstart/manual testing). Not used by
// runSubscriptionCheck, which maps queryArxiv's already-parsed entries directly.
export function parseArxivAtom(xml: string): PaperCandidate[] {
	const doc = new DOMParser().parseFromString(xml, 'application/xml');
	const entries = Array.from(doc.getElementsByTagName('entry'));
	const candidates: PaperCandidate[] = [];
	for (const entry of entries) {
		const candidate = parseArxivEntry(entry);
		if (candidate !== undefined) {
			candidates.push(candidate);
		}
	}
	return candidates;
}
