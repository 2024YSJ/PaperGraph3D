import type { Paper } from '../models/paper';

export type ReadState = 'unread' | 'read';

// Bump when the wrapped-record shape changes so migrate() can normalize (FR-016).
// v1 = pre-embedding records; v2 = embedding fields present on the nested paper.
export const CURRENT_SCHEMA_VERSION = 2;

// The wrapped superset: the serialized 001 Paper (which itself carries the
// embedding fields) plus persistence/cross-feature metadata (FR-016/FR-022).
export interface PaperRecord {
	schemaVersion: number;
	paper: Paper;
	createdAt: number;
	updatedAt: number;
	readState: ReadState;
	summary?: string;
	futureDirections?: string;
}

// What a caller hands in to persist (002/005 supply the Paper + any fields they own).
export interface PersistInput {
	paper: Paper;
	summary?: string;
	futureDirections?: string;
	readState?: ReadState;
}

// Embedding preserve-unless-supplied: an incoming null (pending) embedding must
// NOT clobber a stored non-null vector; only a non-null embedding replaces it
// (FR-004, SC-007, Clarification 2026-07-08).
function mergePaper(incoming: Paper, prev: Paper): Paper {
	if (incoming.embedding === null && prev.embedding !== null) {
		return {
			...incoming,
			embedding: prev.embedding,
			embeddingModel: prev.embeddingModel,
			embeddingSource: prev.embeddingSource,
		};
	}
	return { ...incoming };
}

// Field-scoped merge (FR-004): overwrite only carried fields; preserve wrapper
// fields the update does not set. On create, seed bookkeeping (FR-020).
export function wrap(input: PersistInput, prev?: PaperRecord): PaperRecord {
	const now = Date.now();
	if (!prev) {
		return {
			schemaVersion: CURRENT_SCHEMA_VERSION,
			paper: { ...input.paper },
			createdAt: now,
			updatedAt: now,
			readState: input.readState ?? 'unread',
			summary: input.summary,
			futureDirections: input.futureDirections,
		};
	}
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		paper: mergePaper(input.paper, prev.paper),
		createdAt: prev.createdAt,
		updatedAt: now,
		readState: input.readState ?? prev.readState,
		summary: input.summary !== undefined ? input.summary : prev.summary,
		futureDirections:
			input.futureDirections !== undefined ? input.futureDirections : prev.futureDirections,
	};
}

export function unwrap(record: PaperRecord): Paper {
	return record.paper;
}

// Normalize an older/foreign record: a paper missing the embedding fields gets
// them set to null (pending); schemaVersion is bumped. Never rejects for a
// missing embedding (FR-016/FR-021). Throws only on structurally unusable input.
export function migrate(raw: unknown): PaperRecord {
	if (typeof raw !== 'object' || raw === null) {
		throw new Error('record is not an object');
	}
	const r = raw as Record<string, unknown>;
	if (typeof r.paper !== 'object' || r.paper === null) {
		throw new Error('record is missing its paper');
	}
	const paper = r.paper as Record<string, unknown>;
	if (paper.embedding === undefined) paper.embedding = null;
	if (paper.embeddingModel === undefined) paper.embeddingModel = null;
	if (paper.embeddingSource === undefined) paper.embeddingSource = null;
	const now = Date.now();
	return {
		schemaVersion: CURRENT_SCHEMA_VERSION,
		paper: paper as unknown as Paper,
		createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
		updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : now,
		readState: r.readState === 'read' ? 'read' : 'unread',
		summary: typeof r.summary === 'string' ? r.summary : undefined,
		futureDirections: typeof r.futureDirections === 'string' ? r.futureDirections : undefined,
	};
}
