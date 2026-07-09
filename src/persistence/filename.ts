import type { PaperSourceId } from '../models/paper';

// Illegal/reserved filename characters across Windows/macOS/Linux, plus control
// chars. The ':' in a sourceId (e.g. 'arxiv:2401.12345') is the main hit.
// '-' and ' ' are intentionally left intact ('-' is the disambiguator below).
// eslint-disable-next-line no-control-regex -- stripping control chars from filenames is intentional
const ILLEGAL_CHARS = new RegExp('[\\\\/:*?"<>|\\u0000-\\u001f]', 'g');
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

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

// Injective against already-used stems: append a deterministic disambiguator on
// the rare post-sanitization clash between two distinct sourceIds (FR-007).
export function fileStem(sourceId: PaperSourceId, taken: ReadonlySet<string>): string {
	const base = sanitizeStem(sourceId);
	if (!taken.has(base)) {
		return base;
	}
	let n = 2;
	while (taken.has(`${base}-${n}`)) {
		n += 1;
	}
	return `${base}-${n}`;
}
