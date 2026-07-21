import type { PaperSourceId } from '../models/paper';
import type { Position } from './types';

// A node without a canonical SPECTER2 vector is placed by a deterministic function of
// its sourceId, in a band OUTSIDE the projected cloud (projections of L2-normalized
// SPECTER2 vectors sit near the origin), so "not yet embedded" is visually separable
// and never collides with a real projected position by coincidence (006 FR-011,
// SC-007; research.md §5). Pure function of sourceId ⇒ identical across runs; needs no
// basis; stable as the corpus changes.
const FALLBACK_X_BASE = 2; // to the right of the ≈[-1,1] projected cloud
const FALLBACK_X_SPREAD = 1; // x ∈ [2, 3)
const FALLBACK_Y_SPREAD = 2; // y ∈ [-1, 1)

// FNV-1a 32-bit — a small, stable, dependency-free string hash.
function hash32(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

export function fallbackPosition(sourceId: PaperSourceId): Position {
	const h = hash32(sourceId);
	const xFrac = (h & 0xffff) / 0x10000; // low 16 bits
	const yFrac = ((h >>> 16) & 0xffff) / 0x10000; // high 16 bits
	return {
		x: FALLBACK_X_BASE + xFrac * FALLBACK_X_SPREAD,
		y: (yFrac - 0.5) * FALLBACK_Y_SPREAD,
	};
}
