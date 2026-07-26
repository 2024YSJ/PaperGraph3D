import type { Paper, PaperSourceId } from '../models/paper';

// 006 output shapes (data-model.md). The year is NOT part of Position — it is
// carried on the node for 007 to map to the fixed year axis.
export interface Position {
	x: number;
	y: number;
}

export type PositionSource = 'projected' | 'fallback';

export interface GraphNode {
	id: PaperSourceId;
	title: string;
	// Full author list from the record (order preserved). 007 decides display/truncation
	// (e.g. "First Author et al.") — 006 carries the complete list.
	authors: string[];
	publicationYear: number;
	// Month/day-precision date (ISO YYYY-MM-DD, UTC) when the record carries one
	// (001 publicationDate); undefined for a year-only paper. Carried so 007 can map
	// the time axis at day granularity rather than only by year. The year field stays
	// the required key; this is additive precision.
	publicationDate: string | undefined;
	citationCount: number;
	citationsKnown: boolean;
	uncited: boolean;
	position: Position;
	positionSource: PositionSource;
}

export interface GraphConnection {
	from: PaperSourceId;
	to: PaperSourceId;
}

export interface GraphData {
	nodes: GraphNode[];
	connections: GraphConnection[];
	// The embeddingModel the layout's projection basis was fit on — lets a consumer
	// detect a stale layout after a canonical-model change (data-model.md).
	basisModel: string;
}

// The narrow, read-only subset of 003's PaperStore that conversion depends on
// (contracts/graph-conversion-api.md). Kept as an interface so the spec-test drives
// it with an in-memory fake, mirroring 004/005's test seams; PaperStore satisfies it
// structurally.
export interface GraphReadStore {
	all(): AsyncIterable<Paper>;
	has(sourceId: PaperSourceId): boolean;
}

// The regenerable projection basis (data-model.md). `mean`/`axes` are over the
// canonical SPECTER2 space (SPECTER2_EMBEDDING_DIM); `fitCount` is the canonical
// paper count at fit time, the baseline for the refit trigger.
export interface ProjectionBasis {
	embeddingModel: string;
	mean: number[];
	axes: [number[], number[]];
	fitCount: number;
}

// Persistence seam for the basis cache — kept separate from 003's record/note store
// so read-only-over-003 holds. The real wiring uses the plugin data blob
// (this.saveData/loadData); the spec-test uses an in-memory fake.
export interface BasisCache {
	load(): Promise<ProjectionBasis | undefined>;
	save(basis: ProjectionBasis): Promise<void>;
}
