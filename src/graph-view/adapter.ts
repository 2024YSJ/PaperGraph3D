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

export const DEFAULT_YEAR_Z_SCALE = 40;
export const DEFAULT_BASE_YEAR = 2000;

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
	yearZScale?: number;
	baseYear?: number;
}

// Publication year -> depth-axis coordinate. Same-year papers share a plane (FR-001);
// the scale controls plane spacing (tune so the graph is neither flat nor stretched).
export function yearToZ(
	year: number,
	scale: number = DEFAULT_YEAR_Z_SCALE,
	baseYear: number = DEFAULT_BASE_YEAR,
): number {
	return (year - baseYear) * scale;
}

export function toForceGraphData(
	data: GraphData,
	options: AdapterOptions = {},
): ForceGraphData {
	const scale = options.yearZScale ?? DEFAULT_YEAR_Z_SCALE;
	const baseYear = options.baseYear ?? DEFAULT_BASE_YEAR;
	return {
		nodes: data.nodes.map((n) => ({
			id: n.id,
			title: n.title,
			publicationYear: n.publicationYear,
			citationCount: n.citationCount,
			citationsKnown: n.citationsKnown,
			uncited: n.uncited,
			positionSource: n.positionSource,
			fx: n.position.x,
			fy: n.position.y,
			fz: yearToZ(n.publicationYear, scale, baseYear),
		})),
		links: data.connections.map((c) => ({ source: c.from, target: c.to })),
	};
}
