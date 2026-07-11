import type { PaperSourceId } from '../models/paper';

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

// Human-readable note filename (FR-007): the paper's TITLE (NFC-normalized, illegal/
// control chars dropped, internal whitespace — including arXiv's line-wrapped titles —
// collapsed, length-capped) followed by the paper's provider-local id in parentheses,
// e.g. 'Attention Is All You Need (2401.12345)'. The id suffix keeps the name injective
// and traceable even when two papers share a (truncated) title.
//
// The filename is display-facing ONLY: the record/note pairing keys on the content
// sourceId (frontmatter pg3d_sourceId), never the filename (FR-009), so a title-based
// name is rename-safe. The stem is fixed at creation and reused on later updates
// (store.updatePath), so a refresh that revises the title does NOT rename the files and
// never breaks a link the user made to them. Falls back to the sourceId stem when the
// title sanitizes to empty.
export function noteStem(
	title: string,
	sourceId: PaperSourceId,
	taken: ReadonlySet<string>,
): string {
	const cleanTitle = title
		.normalize('NFC')
		.replace(ILLEGAL_CHARS, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_TITLE_LENGTH)
		.replace(/[ .]+$/g, '');
	if (cleanTitle.length === 0) {
		return fileStem(sourceId, taken);
	}
	const localId = sourceId.slice(sourceId.indexOf(':') + 1);
	return disambiguate(sanitizeStem(`${cleanTitle} (${localId})`), taken);
}
