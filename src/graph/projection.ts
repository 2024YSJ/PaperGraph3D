// Deterministic top-2 PCA over canonical SPECTER2 vectors, computed in-process with no
// external library (006 OQ-4; research.md §3/§4/§6). It never forms the D×D covariance:
// each power-iteration step is two matrix-vector products against the centered data.
// A fixed hash-derived seed (not RNG), a fixed iteration cap, deflation for PC2, and
// largest-|component| sign-canonicalization make the whole thing reproducible (FR-009).

const POWER_ITERATIONS = 200;
const CONVERGENCE_TOL = 1e-10;

function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
	return sum;
}

function normalizeInPlace(v: number[]): number[] {
	const n = Math.sqrt(dot(v, v));
	if (n === 0) return v;
	for (let i = 0; i < v.length; i += 1) v[i] = (v[i] ?? 0) / n;
	return v;
}

// Deterministic, non-degenerate seed (hash-derived, NOT RNG) so power iteration has a
// component along the top eigenvector with overwhelming probability.
function seedVector(dim: number): number[] {
	const v = new Array<number>(dim);
	for (let i = 0; i < dim; i += 1) {
		v[i] = ((Math.imul(i + 1, 2654435761) >>> 0) % 2000) / 1000 - 1; // ∈ [-1, 1)
	}
	return normalizeInPlace(v);
}

// Top eigenvector of the covariance of already-centered `rows` via power iteration on
// the implicit covariance: w = Σ_i (row_i · v) row_i.
function topEigenvector(rows: number[][], dim: number): number[] {
	let v = seedVector(dim);
	for (let iter = 0; iter < POWER_ITERATIONS; iter += 1) {
		const w = new Array<number>(dim).fill(0);
		for (const row of rows) {
			const proj = dot(row, v);
			for (let i = 0; i < dim; i += 1) w[i] = (w[i] ?? 0) + proj * (row[i] ?? 0);
		}
		const n = Math.sqrt(dot(w, w));
		if (n === 0) break;
		for (let i = 0; i < dim; i += 1) w[i] = (w[i] ?? 0) / n;
		const converged = 1 - Math.abs(dot(v, w)) < CONVERGENCE_TOL;
		v = w;
		if (converged) break;
	}
	return v;
}

// Flip sign so the largest-magnitude entry is positive (ties → lowest index), fixing
// the eigenvector's sign ambiguity so the layout never mirror-flips (FR-009).
function signCanonicalize(v: number[]): number[] {
	let maxAbs = -1;
	let maxIdx = 0;
	for (let i = 0; i < v.length; i += 1) {
		const a = Math.abs(v[i] ?? 0);
		if (a > maxAbs) {
			maxAbs = a;
			maxIdx = i;
		}
	}
	return (v[maxIdx] ?? 0) < 0 ? v.map((x) => -x) : v;
}

export interface FittedBasis {
	mean: number[];
	axes: [number[], number[]];
}

// Fit the top-2 sign-canonicalized principal axes + mean over `vectors` (each length
// `dim`). Caller guarantees vectors.length >= a sensible minimum and uniform length.
export function fitBasis(vectors: number[][], dim: number): FittedBasis {
	const count = vectors.length;
	const mean = new Array<number>(dim).fill(0);
	for (const v of vectors) {
		for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) + (v[i] ?? 0);
	}
	for (let i = 0; i < dim; i += 1) mean[i] = (mean[i] ?? 0) / count;

	const rows = vectors.map((v) => v.map((x, i) => x - (mean[i] ?? 0)));
	const pc1 = signCanonicalize(topEigenvector(rows, dim));
	const deflated = rows.map((row) => {
		const proj = dot(row, pc1);
		return row.map((x, i) => x - proj * (pc1[i] ?? 0));
	});
	const pc2 = signCanonicalize(topEigenvector(deflated, dim));
	return { mean, axes: [pc1, pc2] };
}

// Out-of-sample transform: place any canonical vector on a stored basis. Existing nodes
// keep their positions because the basis is frozen between refits (FR-010/SC-006).
export function project(vector: number[], mean: number[], axes: [number[], number[]]): { x: number; y: number } {
	const centered = vector.map((x, i) => x - (mean[i] ?? 0));
	return { x: dot(centered, axes[0]), y: dot(centered, axes[1]) };
}
