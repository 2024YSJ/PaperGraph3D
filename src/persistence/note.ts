import type { PaperRecord } from './record';

const BEGIN = '<!-- pg3d:begin -->';
const END = '<!-- pg3d:end -->';

export interface NoteRegions {
	frontmatter: Record<string, unknown>;
	managedBody: string;
	userBody: string;
}

// We own the frontmatter (a fixed, small schema), so a minimal emitter/parser for
// it keeps note.ts Obsidian-free and offline-testable (research.md §1/§2). Values
// are emitted as JSON-quoted scalars, which are valid YAML double-quoted scalars.
function quote(value: string): string {
	return JSON.stringify(value);
}

// The paper's canonical web URL, derived from its stable `sourceId` (001) rather
// than stored — the JSON record already carries sourceId, so a stored URL would be
// redundant and could drift. `provider:local` splits on the first colon (mirrors
// isPaperSourceId in models/paper.ts). Returns undefined for an unrecognized
// provider so the frontmatter simply omits the line rather than emit a bad link.
function paperUrl(sourceId: string): string | undefined {
	const separator = sourceId.indexOf(':');
	if (separator <= 0) {
		return undefined;
	}
	const provider = sourceId.slice(0, separator);
	const localId = sourceId.slice(separator + 1);
	if (localId.length === 0) {
		return undefined;
	}
	switch (provider) {
		case 'arxiv':
			return `https://arxiv.org/abs/${localId}`;
		case 'semanticScholar':
			return `https://www.semanticscholar.org/paper/${localId}`;
		default:
			return undefined;
	}
}

// FR-002 mirrored subset. `schemaVersion` / timestamps / the embedding vector stay in
// the JSON record only; the outbound `references` (the source ids of the papers this
// paper cites) ARE mirrored here as a readable list (amended 2026-07-11).
function renderFrontmatter(record: PaperRecord): string {
	const p = record.paper;
	const lines: string[] = [`title: ${quote(p.title)}`];
	if (p.authors.length === 0) {
		lines.push('authors: []');
	} else {
		lines.push('authors:');
		for (const author of p.authors) {
			lines.push(`  - ${quote(author)}`);
		}
	}
	lines.push(`publicationYear: ${p.publicationYear}`);
	// Month/day precision when known (001 publicationDate); omitted for a year-only paper.
	if (p.publicationDate !== undefined) {
		lines.push(`publicationDate: ${quote(p.publicationDate)}`);
	}
	lines.push(`citationCount: ${p.citationCount}`);
	// Outbound citations — the source ids of the papers this paper cites (001 references).
	// Three honest states, keyed on `citationsKnown` (001/002 FR-018), so an empty list is
	// never confused with "not looked up yet":
	//   - not confirmed by a citation-aware provider (un-enriched, or a failed/pending
	//     enrichment) -> `references: null` ("unknown"; the note is only (re)written when an
	//     operation settles, so an in-flight check never shows a half-state);
	//   - confirmed, cites nothing resolvable -> `references: []`;
	//   - confirmed with citations -> a readable YAML list of source ids.
	if (!p.citationsKnown) {
		lines.push('references: null');
	} else if (p.references.length === 0) {
		lines.push('references: []');
	} else {
		lines.push('references:');
		for (const reference of p.references) {
			lines.push(`  - ${quote(reference)}`);
		}
	}
	// Subscription provenance — the subscriptionKey(s) that collected this paper.
	// Empty ([]) for a paper predating this field or not collected via a subscription.
	if (p.collectedVia.length === 0) {
		lines.push('collectedVia: []');
	} else {
		lines.push('collectedVia:');
		for (const key of p.collectedVia) {
			lines.push(`  - ${quote(key)}`);
		}
	}
	lines.push(`readState: ${quote(record.readState)}`);
	lines.push(`pg3d_sourceId: ${quote(p.sourceId)}`);
	// Canonical web URL derived from sourceId (see paperUrl); omitted for an
	// unrecognized provider rather than emitting a broken link.
	const url = paperUrl(p.sourceId);
	if (url !== undefined) {
		lines.push(`url: ${quote(url)}`);
	}
	return lines.join('\n');
}

// The rendered prose for the managed body block: abstract, replaced by the summary
// when present, plus future-directions when present (FR-002). Never the embedding.
function renderProse(record: PaperRecord): string {
	const base = record.summary ?? record.paper.abstract;
	if (record.futureDirections) {
		return `${base}\n\n## Future directions\n\n${record.futureDirections}`;
	}
	return base;
}

// Managed region (frontmatter + delimited body block) followed verbatim by the
// user's free-form body. The user body is appended unchanged (FR-005).
export function renderNote(record: PaperRecord, previousUserBody: string): string {
	return `---\n${renderFrontmatter(record)}\n---\n${BEGIN}\n${renderProse(record)}\n${END}\n${previousUserBody}`;
}

// Tolerant splitter into the three regions. Only pg3d_sourceId/readState are read
// from the frontmatter; the user body is never parsed as state (FR-005/FR-009).
export function parseNote(text: string): NoteRegions {
	let rest = text;
	let frontmatter: Record<string, unknown> = {};
	if (rest.startsWith('---\n')) {
		const end = rest.indexOf('\n---', 4);
		if (end !== -1) {
			frontmatter = parseFrontmatter(rest.slice(4, end));
			rest = rest.slice(end + 4).replace(/^\n/, '');
		}
	}
	let managedBody = '';
	let userBody = rest;
	const begin = rest.indexOf(BEGIN);
	const endMarker = rest.indexOf(END);
	if (begin !== -1 && endMarker !== -1 && endMarker > begin) {
		managedBody = rest
			.slice(begin + BEGIN.length, endMarker)
			.replace(/^\n/, '')
			.replace(/\n$/, '');
		userBody = rest.slice(endMarker + END.length).replace(/^\n/, '');
	}
	return { frontmatter, managedBody, userBody };
}

function parseScalar(raw: string): unknown {
	const t = raw.trim();
	if (t.startsWith('"')) {
		try {
			return JSON.parse(t) as unknown;
		} catch {
			return t;
		}
	}
	if (t === '[]') return [];
	const n = Number(t);
	return t !== '' && !Number.isNaN(n) ? n : t;
}

function parseFrontmatter(text: string): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	let listKey: string | null = null;
	let list: string[] = [];
	const flush = (): void => {
		if (listKey) {
			out[listKey] = list;
			listKey = null;
			list = [];
		}
	};
	for (const line of text.split('\n')) {
		const item = line.match(/^\s+-\s+(.*)$/);
		if (listKey && item) {
			list.push(String(parseScalar(item[1] as string)));
			continue;
		}
		flush();
		const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (!kv) continue;
		const key = kv[1] as string;
		const value = kv[2] as string;
		if (value === '') {
			listKey = key;
			list = [];
		} else {
			out[key] = parseScalar(value);
		}
	}
	flush();
	return out;
}
