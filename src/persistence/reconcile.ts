// Pure classification + naming helpers for the load scan. The scan and
// reconciliation touch only `.json`+`.md` paper pairs; every other file — the
// projection-basis cache (FR-023), tombstone markers — is ignored (FR-013).

export const TOMBSTONE_SUFFIX = '.pg3d-del';

export type FileKind = 'json' | 'md' | 'tombstone' | 'other';

export function classify(path: string): FileKind {
	if (path.endsWith(TOMBSTONE_SUFFIX)) return 'tombstone';
	if (path.endsWith('.json')) return 'json';
	if (path.endsWith('.md')) return 'md';
	return 'other';
}

// The filename stem (name without its `.json`/`.md`/tombstone extension).
export function stemOf(path: string): string {
	if (path.endsWith(TOMBSTONE_SUFFIX)) {
		return path.slice(0, -TOMBSTONE_SUFFIX.length);
	}
	const dot = path.lastIndexOf('.');
	return dot === -1 ? path : path.slice(0, dot);
}

export function tombstoneName(stem: string): string {
	return `${stem}${TOMBSTONE_SUFFIX}`;
}
