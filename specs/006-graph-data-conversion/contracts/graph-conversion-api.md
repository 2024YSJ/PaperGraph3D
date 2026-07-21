# Contract: Graph Data Conversion API (`src/graph/`)

The interface 006 exposes to its consumers (007 rendering, 008 wiring). Types are TypeScript-shaped for precision; they are the 006-owned output shapes from [data-model.md](../data-model.md). Inputs are imported 001/003 types, never redefined.

## Public types

```ts
export interface Position { x: number; y: number }               // finite; year is NOT here

export interface GraphNode {
  id: PaperSourceId;                                              // = paper.sourceId, unique
  title: string;
  publicationYear: number;                                       // required (year-less excluded)
  citationCount: number;
  citationsKnown: boolean;
  uncited: boolean;                                              // isUncited(paper), FR-012
  position: Position;
  positionSource: 'projected' | 'fallback';
}

export interface GraphConnection { from: PaperSourceId; to: PaperSourceId }  // directional, no self-loop

export interface GraphData {
  nodes: GraphNode[];
  connections: GraphConnection[];
  basisModel: string;                                            // embeddingModel the layout was fit on
}
```

## Entry point

```ts
// The single conversion call. Read-only over 003; draws nothing; never re-embeds.
export function convertToGraphData(
  store: GraphReadStore,                // 003 read surface (subset below)
  basisCache: BasisCache,               // regenerable projection-basis cache seam
  options?: { recompute?: boolean },    // recompute: true forces a basis refit — the FR-010 "recompute layout" trigger
): Promise<GraphData>;
```

### `GraphReadStore` (003 read surface — subset actually used)

```ts
export interface GraphReadStore {
  all(): AsyncIterable<Paper>;                 // = PaperStore.all()
  has(sourceId: PaperSourceId): boolean;       // = PaperStore.has() — O(1) edge-target existence
}
```

- 006 depends only on this narrow read interface (kept as an interface so the spec-test drives it without a real Obsidian `FileStore`, mirroring 004/005 test seams). `PaperStore` satisfies it structurally.

### `BasisCache` (projection-basis persistence seam)

```ts
export interface ProjectionBasis {
  embeddingModel: string;
  mean: number[];                              // length 768
  axes: [number[], number[]];                  // two length-768 sign-canonicalized axes
  fitCount: number;
}

export interface BasisCache {
  load(): Promise<ProjectionBasis | undefined>;   // undefined => none yet / invalid => refit
  save(basis: ProjectionBasis): Promise<void>;    // via plugin saveData; separate from 003 store
}
```

- Kept as a seam so the spec-test uses an in-memory fake and the real wiring uses `this.saveData`/`this.loadData` — no Obsidian dependency in the conversion logic itself.

## Behavioral contract (maps to spec FR/SC)

| Guarantee | Spec |
|-----------|------|
| One node per stored paper **with a publication year**; year-less and malformed records skipped, never fail the run | FR-001/FR-002/FR-006, SC-001 |
| Reads only canonical JSON records via `store.all()`; never parses Markdown | FR-001, SC-004 |
| Edge `from→to` iff `to ∈ from.references` **and** `store.has(to)` **and** `to !== from`; unresolved refs dropped | FR-003/FR-005, SC-002 (OQ-2) |
| Empty/undefined `references` → no edges; `citationsKnown` carried for the enriched-vs-uncited distinction | FR-003 (OQ-1) |
| Cited-by never emitted; consumer inverts `connections` if needed | FR-004 |
| Canonical (`embeddingModel === SPECTER2_EMBEDDING_MODEL`) vectors → PCA `position`, `positionSource: 'projected'` | FR-008/FR-009 |
| Deterministic: same corpus + same basis ⇒ identical `GraphData` (byte-stable positions, no mirror-flip) | FR-009, SC-005 |
| New canonical paper placed out-of-sample on the cached basis; existing nodes unmoved unless a refit trigger fires | FR-010, SC-006 |
| Pending/non-canonical/absent embedding → deterministic fallback `position`, `positionSource: 'fallback'`, never dropped, never re-embedded (002 re-embed converges later; eventually consistent) | FR-011, SC-007 |
| `uncited` = shared `isUncited` only, never in-graph inbound degree | FR-012, SC-008 |
| Produces data only — no rendering, no writes to 003 records/notes | FR-007, Out of Scope |

## Non-goals (explicit)

- No rendering / interaction (007).
- No embedding computation or re-embedding (002; 006 reads existing vectors).
- No citation fetch/refresh (002/005).
- No UMAP "cluster mode" in v1 (deferred; the `projection.ts` seam keeps it additive).
