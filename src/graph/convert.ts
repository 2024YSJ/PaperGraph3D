import { SPECTER2_EMBEDDING_DIM, SPECTER2_EMBEDDING_MODEL } from '../collection/localTransformer';
import type { Paper, PaperSourceId } from '../models/paper';
import { shouldRefit } from './basisCache';
import { buildConnections } from './edges';
import { fallbackPosition } from './fallback';
import { toNodeBase, type NodeBase } from './nodes';
import { fitBasis, project } from './projection';
import type { BasisCache, GraphConnection, GraphData, GraphNode, GraphReadStore, ProjectionBasis } from './types';

// Below this many canonical papers a 2-component similarity layout is not meaningful,
// so no basis is fit and every node falls back until the canonical corpus is larger.
const MIN_FIT_COUNT = 3;

// The paper's content vector iff it is in the canonical SPECTER2 space (right model id,
// present, right dimension); otherwise undefined (⇒ fallback position, never re-embedded
// here — 002's background re-embed converges it, FR-011).
function canonicalVectorOf(paper: Paper): number[] | undefined {
	if (
		paper.embeddingModel === SPECTER2_EMBEDDING_MODEL &&
		Array.isArray(paper.embedding) &&
		paper.embedding.length === SPECTER2_EMBEDDING_DIM
	) {
		return paper.embedding;
	}
	return undefined;
}

// Convert the persisted corpus into graph data: nodes (one per paper with a year),
// directional citation connections, and a deterministic PCA layout for canonical-space
// nodes (fallback for the rest). Read-only over 003; draws nothing; never re-embeds.
// The projection basis is fit/reused via `basisCache` and only refit on the defined
// triggers, so existing nodes stay put out-of-sample (FR-010/SC-006).
export async function convertToGraphData(
	store: GraphReadStore,
	basisCache: BasisCache,
	options: { recompute?: boolean } = {},
): Promise<GraphData> {
	// 1. Enumerate + build node bases (year gate, uncited); keep each node's references
	//    and canonical vector for the later phases.
	const kept: {
		base: NodeBase;
		references: readonly PaperSourceId[] | undefined;
		vec: number[] | undefined;
	}[] = [];
	for await (const paper of store.all()) {
		const base = toNodeBase(paper);
		if (base === undefined) continue; // year-less / malformed ⇒ excluded
		kept.push({ base, references: paper.references, vec: canonicalVectorOf(paper) });
	}
	const nodeIds = new Set<PaperSourceId>(kept.map((entry) => entry.base.id));

	// 2. Projection basis over canonical vectors — fit/refit per triggers, or reuse.
	const canonicalVectors = kept.map((entry) => entry.vec).filter((v): v is number[] => v !== undefined);
	const canonicalCount = canonicalVectors.length;
	let basis = await basisCache.load();
	const wantFit =
		canonicalCount >= MIN_FIT_COUNT &&
		(options.recompute === true ||
			shouldRefit(basis, canonicalCount, SPECTER2_EMBEDDING_MODEL, SPECTER2_EMBEDDING_DIM));
	if (wantFit) {
		const fitted = fitBasis(canonicalVectors, SPECTER2_EMBEDDING_DIM);
		basis = {
			embeddingModel: SPECTER2_EMBEDDING_MODEL,
			mean: fitted.mean,
			axes: fitted.axes,
			fitCount: canonicalCount,
		};
		await basisCache.save(basis);
	}
	const usableBasis: ProjectionBasis | undefined =
		basis !== undefined && basis.embeddingModel === SPECTER2_EMBEDDING_MODEL && basis.mean.length === SPECTER2_EMBEDDING_DIM
			? basis
			: undefined;

	// 3. Assemble nodes (projected canonical, deterministic fallback otherwise) + edges.
	const nodes: GraphNode[] = [];
	const connections: GraphConnection[] = [];
	for (const { base, references, vec } of kept) {
		if (usableBasis !== undefined && vec !== undefined) {
			const position = project(vec, usableBasis.mean, usableBasis.axes);
			nodes.push({ ...base, position, positionSource: 'projected' });
		} else {
			nodes.push({ ...base, position: fallbackPosition(base.id), positionSource: 'fallback' });
		}
		for (const connection of buildConnections(base.id, references, nodeIds)) {
			connections.push(connection);
		}
	}

	return { nodes, connections, basisModel: SPECTER2_EMBEDDING_MODEL };
}
