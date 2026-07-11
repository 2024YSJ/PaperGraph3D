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

// FR-002 mirrored subset only. Raw references / schemaVersion / timestamps /
// embedding are never written here.
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
	lines.push(`readState: ${quote(record.readState)}`);
	lines.push(`pg3d_sourceId: ${quote(p.sourceId)}`);
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
