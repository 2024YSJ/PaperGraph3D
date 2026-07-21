# Phase 1 Data Model: Graph Data Conversion

All types are **006-owned output shapes** produced from the read-only 001 `Paper` inputs. 006 never redefines `Paper`, `PaperSourceId`, or any 001/003 type — it imports them. The graph-data output is transient (returned to the caller); only the projection basis is persisted (via `saveData`).

## Inputs (imported, read-only)

| Source | Used | Notes |
|--------|------|-------|
| `Paper` (001 `src/models/paper.ts`) | `publicationYear`, `sourceId`, `references`, `citationCount`, `citationsKnown`, `embedding`, `embeddingModel` | Never mutated |
| `PaperSourceId` (001) | node id + edge endpoints | `${provider}:${id}` (e.g. `arxiv:2401.00001`) |
| `PaperStore` (003) | `all()`, `has(sourceId)` | Enumeration + O(1) edge-target existence |
| `SPECTER2_EMBEDDING_MODEL` / `SPECTER2_EMBEDDING_DIM` (002) | canonical predicate, projection dimensionality | `local-specter2-proximity-v1-d768`, 768 |
| `isUncited` (relocated `src/models/uncited.ts`) | node uncited flag | `citationsKnown === true && citationCount === 0` |

## Output entities

### `Position`

| Field | Type | Rule |
|-------|------|------|
| `x` | `number` | Finite. From PCA (projected) or the deterministic fallback. |
| `y` | `number` | Finite. Same source as `x`. |

The year (z axis) is **not** part of `Position` — it lives on the node as `publicationYear` for 007 to map to the fixed year axis.

### `GraphNode`

| Field | Type | Rule / Source |
|-------|------|---------------|
| `id` | `PaperSourceId` | = the paper's `sourceId`. Unique across the node list. |
| `title` | `string` | From `Paper.title`. |
| `publicationYear` | `number` | Required — a record without it is excluded (FR-002). Carried for 007's year axis; never projected. |
| `citationCount` | `number` | From `Paper.citationCount`. |
| `citationsKnown` | `boolean` | From `Paper.citationsKnown`. Lets 007 tell "confirmed uncited" from "not yet enriched". |
| `uncited` | `boolean` | `isUncited(paper)` — the shared rule (FR-012). |
| `position` | `Position` | Projected (canonical embedding) or fallback (pending/non-canonical, FR-011). |
| `positionSource` | `'projected' \| 'fallback'` | Marks whether `position` came from PCA or the deterministic fallback, so 007 may render pending nodes distinctly and a re-run's "snap" is observable. |

**Validation / invariants**
- One node per stored paper that has a `publicationYear`; year-less and malformed records are omitted (SC-001).
- `position` is always finite; a missing/non-canonical embedding yields `positionSource: 'fallback'`, never a failure (SC-007).
- `uncited` is derived only from `isUncited`, never from in-graph inbound degree.

### `GraphConnection`

| Field | Type | Rule / Source |
|-------|------|---------------|
| `from` | `PaperSourceId` | The citing paper's `sourceId`. |
| `to` | `PaperSourceId` | A `sourceId` in `from`'s `references` that exists in the corpus (`store.has(to) === true`). |

**Validation / invariants**
- `from` and every `to` are ids of nodes present in the node list.
- `from !== to` (no self-loops).
- A reference that does not resolve to a stored paper produces **no** connection (dangling drop, FR-005); it never fabricates a `to` node.
- Directional only; cited-by is derived by the consumer via inversion (FR-004), never stored.

### `GraphData` (the transient output)

| Field | Type | Rule |
|-------|------|------|
| `nodes` | `GraphNode[]` | All converted nodes. |
| `connections` | `GraphConnection[]` | All resolved directional edges. |
| `basisModel` | `string` | The `embeddingModel` the projection basis was fit on (= `SPECTER2_EMBEDDING_MODEL`). Lets 007/callers detect a stale layout after a model change. |

Not persisted as its own file — returned to the caller (007/008). Re-derivable at any time from the corpus + cached basis.

## Persisted artifact

### `ProjectionBasis` (regenerable cache)

| Field | Type | Rule |
|-------|------|------|
| `embeddingModel` | `string` | Space this basis was fit on. A mismatch with the current canonical model invalidates the cache → refit (FR-010). |
| `mean` | `number[]` | Length = `SPECTER2_EMBEDDING_DIM` (768). Centering vector. |
| `axes` | `[number[], number[]]` | The two sign-canonicalized principal axes, each length 768. |
| `fitCount` | `number` | Count of canonical papers at fit time — the baseline for the ≥20%/≥25-paper refit trigger. |

**Lifecycle / rules**
- Persisted via `this.saveData` under a dedicated key (e.g. `graphProjectionBasis`), beside `settings`/`subscriptions`; **separate from 003's record/note store** (preserves read-only-over-003).
- Fully regenerable: a missing, malformed, or model-mismatched cache is discarded and refit from the corpus — losing it never loses data.
- Refit triggers (FR-010): canonical-corpus growth ≥20% since `fitCount` **and** ≥25 new canonical papers; explicit "recompute layout"; `embeddingModel` change. Otherwise the frozen basis places new nodes out-of-sample (SC-006).
- Projection transform for a canonical vector `v`: `x = dot(v − mean, axes[0])`, `y = dot(v − mean, axes[1])`.

## Relationships

```text
PaperStore.all() ──> [Paper] ──┬─(year gate + isUncited + carried fields)─> GraphNode
                               │
                               ├─(references × store.has, exact id, no self-loop)─> GraphConnection
                               │
                               └─(canonical embedding? ── yes ─> PCA transform via ProjectionBasis ─> Position{projected})
                                                        └─ no  ─> deterministic sourceId-hash fallback ─> Position{fallback}

ProjectionBasis  <──fit (top-2 PCA, sign-canonicalized) over canonical vectors── [Paper.embedding]
                 ──persist/load via saveData (regenerable, separate from 003 store)──
```
