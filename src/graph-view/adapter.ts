import type { GraphData } from '../graph/types';

// Maps 006's GraphData onto the { nodes, links } shape 3d-force-graph consumes (007
// FR-014). Three mismatches are resolved here and nowhere else:
//   1. `connections` -> `links`, `{from,to}` -> `{source,target}`.
//   2. `position:{x,y}` + separate `publicationYear` -> flat fixed coords fx/fy/fz.
//   3. the year axis (fz) is computed HERE — 006 deliberately does NOT project year
//      (006 FR-008); mapping publication year to the depth axis is 007's job (FR-001).
// Every other GraphNode field rides along untouched so node accessors (color/size/
// label) can read them directly. New objects are returned — never the 006 output —
// because 3d-force-graph mutates the node/link objects it is given.

// 006's raw x,y magnitudes vary a lot: SPECTER2 PCA projections are TINY (L2-normalized
// vectors → typically ≈0.1–0.4), while fallback positions are ≈2–3. A fixed multiplier
// therefore leaves a real (SPECTER2) cloud cramped. So we AUTO-SCALE: size the cloud so
// its RMS radius hits `xyRadius`, spreading nodes to a consistent, comfortable extent
// regardless of raw magnitude. dayZScale sets depth spacing per DAY. Both live here in
// 007 because visual mapping is 007's job (006 owns only the layout *data*).
export const DEFAULT_XY_RADIUS = 130;
// Depth axis is DAY-granular: each calendar day advances z by this much. Papers
// published on the same day share a plane; different days sit on different planes.
export const DEFAULT_DAY_Z_SCALE = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface ForceNode {
	id: string;
	title: string;
	publicationYear: number;
	citationCount: number;
	citationsKnown: boolean;
	uncited: boolean;
	positionSource: 'projected' | 'fallback';
	// Fixed coordinates — force simulation must be disabled (cooldownTicks(0)) since
	// 006 already determines x,y and year owns z.
	fx: number;
	fy: number;
	fz: number;
}

export interface ForceLink {
	source: string;
	target: string;
}

export interface ForceGraphData {
	nodes: ForceNode[];
	links: ForceLink[];
}

export interface AdapterOptions {
	xyRadius?: number;
	dayZScale?: number;
}

// Day-granular time key: whole days since the Unix epoch (UTC). Uses publicationDate
// (YYYY-MM-DD) when 006 carries one; a year-only paper falls back to Jan 1 of its year
// so it still orders sensibly on the same day-scale (never mixed with a different unit).
export function epochDayOf(publicationDate: string | undefined, publicationYear: number): number {
	const iso = publicationDate ?? `${publicationYear}-01-01`;
	const ms = Date.parse(`${iso}T00:00:00Z`);
	const days = Number.isFinite(ms) ? Math.floor(ms / DAY_MS) : Math.floor(Date.parse(`${publicationYear}-01-01T00:00:00Z`) / DAY_MS);
	return days;
}

export function toForceGraphData(
	data: GraphData,
	options: AdapterOptions = {},
): ForceGraphData {
	const radius = options.xyRadius ?? DEFAULT_XY_RADIUS;
	const dayScale = options.dayZScale ?? DEFAULT_DAY_Z_SCALE;

	// Auto-scale the in-plane coordinates so the cloud's RMS radius hits `radius`,
	// regardless of whether the raw values are tiny (SPECTER2 projection) or larger
	// (fallback band). Without this a real SPECTER2 cloud collapses onto a speck.
	let sumSq = 0;
	for (const n of data.nodes) {
		sumSq += n.position.x * n.position.x + n.position.y * n.position.y;
	}
	const rms = data.nodes.length > 0 ? Math.sqrt(sumSq / data.nodes.length) : 0;
	const spread = rms > 0 ? radius / rms : 1;

	const nodes: ForceNode[] = data.nodes.map((n) => ({
		id: n.id,
		title: n.title,
		publicationYear: n.publicationYear,
		citationCount: n.citationCount,
		citationsKnown: n.citationsKnown,
		uncited: n.uncited,
		positionSource: n.positionSource,
		fx: n.position.x * spread,
		fy: n.position.y * spread,
		// Depth axis by DAY: whole-days-since-epoch × per-day spacing. Same-day papers
		// share a plane; consecutive days sit one dayScale apart.
		fz: epochDayOf(n.publicationDate, n.publicationYear) * dayScale,
	}));

	// Recenter on the cloud's centroid so the graph sits at the origin. The default
	// trackball camera orbits/zooms around (0,0,0); without this the cloud is thousands
	// of units away (days-since-epoch is a large z offset, the fallback band a large x
	// offset), so zooming just approaches empty origin and never reaches the nodes.
	// Relative positions — and the day-plane ordering — are unchanged.
	if (nodes.length > 0) {
		let cx = 0;
		let cy = 0;
		let cz = 0;
		for (const n of nodes) {
			cx += n.fx;
			cy += n.fy;
			cz += n.fz;
		}
		cx /= nodes.length;
		cy /= nodes.length;
		cz /= nodes.length;
		for (const n of nodes) {
			n.fx -= cx;
			n.fy -= cy;
			n.fz -= cz;
		}
	}

	return {
		nodes,
		links: data.connections.map((c) => ({ source: c.from, target: c.to })),
	};
}
