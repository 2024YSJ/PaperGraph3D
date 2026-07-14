import type { Paper, PaperSourceId } from '../models/paper';

// Illegal/reserved filename characters across Windows/macOS/Linux, plus control
// chars. The ':' in a sourceId (e.g. 'arxiv:2401.12345') is the main hit.
// '-' and ' ' are intentionally left intact ('-' is the disambiguator below).
// eslint-disable-next-line no-control-regex -- stripping control chars from filenames is intentional
const ILLEGAL_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]', 'g');
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Keep a readable, title-based note name well within OS path limits (Windows' ~260
// total-path budget in particular), leaving room for the folder path + " (id)" suffix.
const MAX_TITLE_LENGTH = 100;

// Readable sanitization: illegal chars -> '_', trailing dots/spaces trimmed. Not
// reversible; the content-level sourceId stays the true key (FR-009).
export function sanitizeStem(sourceId: string): string {
	let stem = sourceId.replace(ILLEGAL_CHARS, '_').replace(/[ .]+$/g, '');
	if (stem.length === 0) {
		stem = '_';
	}
	if (WINDOWS_RESERVED.test(stem)) {
		stem = `_${stem}`;
	}
	return stem;
}

// Append a deterministic disambiguator on a clash with an already-used stem (FR-007).
function disambiguate(base: string, taken: ReadonlySet<string>): string {
	if (!taken.has(base)) {
		return base;
	}
	let n = 2;
	while (taken.has(`${base}-${n}`)) {
		n += 1;
	}
	return `${base}-${n}`;
}

// Injective, sourceId-based stem — the stable fallback used when a paper has no usable
// title (FR-007), and directly for non-note callers/tests.
export function fileStem(sourceId: PaperSourceId, taken: ReadonlySet<string>): string {
	return disambiguate(sanitizeStem(sourceId), taken);
}

// Bare, single-segment note name: the paper's TITLE (NFC-normalized, illegal/control
// chars dropped, whitespace — incl. arXiv's line-wrapped titles — collapsed, length-
// capped) + its provider-local id in parentheses, e.g. 'Attention Is All You Need
// (2401.12345)'; falls back to the sourceId sanitization for an untitled paper. Never
// contains a path separator (the year/month folder is added by noteStem).
function baseNoteName(title: string, sourceId: PaperSourceId): string {
	const cleanTitle = title
		.normalize('NFC')
		.replace(ILLEGAL_CHARS, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_TITLE_LENGTH)
		.replace(/[ .]+$/g, '');
	if (cleanTitle.length === 0) {
		return sanitizeStem(sourceId);
	}
	const localId = sourceId.slice(sourceId.indexOf(':') + 1);
	return sanitizeStem(`${cleanTitle} (${localId})`);
}

// Year/month/day folder for a paper (FR-007): `<YYYY>/<MM>/<DD>`. The YEAR is
// `publicationYear` (always present on a valid Paper); the MONTH and DAY come from
// `publicationDate` (001 FR-023). When only a bare year is known (no full date), falls
// back to `<YYYY>/unknown` rather than fabricating a month/day.
export function publicationDir(paper: Pick<Paper, 'publicationYear' | 'publicationDate'>): string {
	if (paper.publicationDate !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(paper.publicationDate)) {
		const month = paper.publicationDate.slice(5, 7);
		const day = paper.publicationDate.slice(8, 10);
		return `${paper.publicationYear}/${month}/${day}`;
	}
	return `${paper.publicationYear}/unknown`;
}

// Full relative note stem shared by the `.json`/`.md` pair — the year/month/day folder
// prefix plus the human-readable title-based name: `<YYYY>/<MM>/<DD>/<title (id)>`, e.g.
// `2024/03/15/Attention Is All You Need (2401.12345)`. Display-facing only: pairing keys on
// the content sourceId, never the path (FR-009), so it is rename-safe; it is fixed at
// creation and reused on updates, so a later title/content revision never re-folders or
// renames. Injective via the parenthesized id (distinct papers never collide even at an
// identical title within the same day), with a deterministic disambiguator on any clash.
export function noteStem(
	paper: Pick<Paper, 'title' | 'sourceId' | 'publicationYear' | 'publicationDate'>,
	taken: ReadonlySet<string>,
): string {
	return disambiguate(`${publicationDir(paper)}/${baseNoteName(paper.title, paper.sourceId)}`, taken);
}
