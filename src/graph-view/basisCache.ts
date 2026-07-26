import type { BasisCache, ProjectionBasis } from '../graph/types';

// 006's convertToGraphData needs a BasisCache (load/save of the regenerable PCA basis).
// 006 keeps this seam abstract on purpose; here are two concrete implementations.

// Session-only, in-memory. The basis is fully regenerable from the corpus, so losing it
// on reload only costs one refit — perfectly adequate for a test harness or a first cut.
export function createInMemoryBasisCache(): BasisCache {
	let basis: ProjectionBasis | undefined;
	return {
		load: async () => basis,
		save: async (next) => {
			basis = next;
		},
	};
}

// Backed by injected read/write of a plugin-data field (the real wiring, 008): the basis
// is a plugin-managed cache separate from 003's record/note store, so persisting it does
// not violate the read-only-over-003 rule.
export function createPersistentBasisCache(
	read: () => Promise<ProjectionBasis | undefined>,
	write: (basis: ProjectionBasis) => Promise<void>,
): BasisCache {
	return { load: read, save: write };
}
