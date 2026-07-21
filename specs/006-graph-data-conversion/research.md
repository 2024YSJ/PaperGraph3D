# Phase 0 Research: Graph Data Conversion

Written against the **real, merged** 001 (`src/models`), 002 (`src/collection`), and 003 (`src/persistence`) on `develop`. Where a decision is already fixed by merged code (not a 006 choice), that is stated explicitly rather than re-litigated. All five spec Open Questions were settled in `/speckit-clarify` (spec.md § Clarifications, Session 2026-07-20); this file records the remaining implementation-level decisions.

## 1. Corpus read surface (load-bearing, not a choice)

**Finding**: 003's `PaperStore` (merged) already exposes exactly what 006 needs, read-only:

```ts
async *all(): AsyncGenerator<Paper>   // store.ts — annotated "enumerate all stored papers for graph build (006)"
get(sourceId): Promise<Paper | undefined>
has(sourceId): boolean                // O(1) index lookup — used for edge target existence
```

**Decision**: 006 enumerates the corpus with `PaperStore.all()` and resolves edge targets with `has(sourceId)` (in-memory index, no disk read per edge). It never calls any create/update/delete surface. `Paper` (001) supplies every field 006 reads: `publicationYear`, `sourceId`, `references`, `citationCount`, `citationsKnown`, `embedding`, `embeddingModel`.

**Rationale**: The enumeration surface was added *for* 006 (003 FR-015c). `has()` is the exact-string-equality edge test (OQ-2) at index speed. Nothing new is required from 003.

## 2. Canonical embedding space (fixed by 002, not a choice)

**Finding**: The canonical space is one fixed model — `SPECTER2_EMBEDDING_MODEL = 'local-specter2-proximity-v1-d768'`, `SPECTER2_EMBEDDING_DIM = 768` (`src/collection/localTransformer.ts`). `reembed.ts`'s `isCanonical(paper)` is exactly `paper.embeddingModel === SPECTER2_EMBEDDING_MODEL`.

**Decision**: 006 projects only vectors whose `embeddingModel === SPECTER2_EMBEDDING_MODEL` (the same predicate `reembed.ts` uses — imported, not re-implemented, to avoid drift). Every other vector (baseline `local-hashtf-*`, pending/absent, or a future model id) is **not** projected: it takes the fallback position (§5). The projection is a `[N × 768] → [N × 2]` map.

**Rationale**: Only one embedding space can be projected together (constitution Additional Constraints; 001 FR-020). Reusing 002's canonical predicate guarantees 006 and 002 agree on "canonical" with zero drift; a dimension is baked into the model id, so a model change is necessarily a different id and a refit trigger (FR-010).

## 3. Projection algorithm — deterministic PCA, in-process

**Decision**: Fit PCA on the centered matrix of canonical vectors and keep the **top 2 principal components**. Compute via the 768×768 covariance matrix and extract the top-2 eigenvectors with **deterministic power iteration + deflation** (fixed iteration count / tolerance, fixed zero-vector seed derived from a constant, not RNG). No external linear-algebra or ML library.

**Rationale**: The spec requires determinism (FR-009/SC-005) and forbids a heavy projection/ML library (OQ-4, constitution I bundle discipline). Only 2 components are ever needed, so a full SVD is overkill — covariance + top-2 power iteration is a few dozen lines, deterministic, and cheap on 768-dim vectors for a personal-vault corpus. Covariance is 768×768 (~2.4 MB doubles) regardless of N, and building it is O(N·768²) streamed — fine in-memory on desktop.

**Alternatives considered**: (a) A JS SVD library (e.g., `ml-pca`) — rejected: adds bundle weight for capability we don't need (we want 2 of 768 components) and pulls RNG-seeded paths that threaten determinism. (b) Randomized SVD — rejected: stochastic, fights determinism. (c) Thin SVD of the centered `[N × 768]` data matrix — viable but larger code and no benefit over covariance-top-2 at this scale.

## 4. Sign-canonicalization rule

**Decision**: After extracting each principal axis, flip its sign so that **the element with the largest absolute value in that eigenvector is positive** (ties broken by the lowest index). Apply per axis (PC1, then PC2). This is a pure function of the fitted basis, independent of data ordering.

**Rationale**: Eigenvectors are sign-ambiguous, so PCA can mirror-flip the layout between runs (FR-009 forbids this). "Largest-magnitude component positive" is the standard deterministic sign fix (used by scikit-learn's `svd_flip` family) and depends only on the eigenvector, so the same corpus always yields the same signed axes.

## 5. Fallback position for pending / non-canonical nodes (FR-011)

**Decision**: A node without a canonical vector gets a **deterministic 2D position derived by hashing its `sourceId`** (stable string hash → two bounded coordinates), placed in a reserved band **outside** the projected cloud's expected range so pending nodes are visually separable and never collide with real positions by coincidence. The year is still carried (FR-011 "within its year plane" = the z/year axis is unaffected; only x,y is the fallback). Position is a pure function of `sourceId` → identical across runs (SC-007).

**Rationale**: The fallback must be deterministic (SC-007), must not fail, and must not be mixed into PCA (FR-008). A `sourceId` hash is deterministic, needs no basis, and is stable as the corpus changes; a reserved band keeps "not yet embedded" visually distinct until 002's background re-embed converges the paper and a later run projects it for real (eventually consistent, FR-011).

**Alternatives considered**: Placing pending nodes at the origin or the corpus centroid — rejected: many pending nodes would stack, and they'd be indistinguishable from genuinely-central papers.

## 6. Out-of-sample placement & the cached basis (FR-010)

**Decision**: The **projection basis** = `{ embeddingModel, mean: number[768], axes: [number[768], number[768]], fitCount: number }`. Projecting any canonical vector is the standard PCA transform: `x = (v − mean) · axis1`, `y = (v − mean) · axis2`. New/added canonical papers are placed by this transform against the **stored** basis (no re-fit), so existing nodes never move. The basis is **refit** only on: corpus growth ≥20% since `fitCount` AND ≥25 new canonical papers, an explicit "recompute layout" request, or `embeddingModel` change (FR-010). Cache is persisted via `saveData` under a dedicated key (e.g. `graphProjectionBasis`), namespaced beside `settings`/`subscriptions`; it is regenerable — a missing/invalid/mismatched-`embeddingModel` cache triggers a fit.

**Rationale**: Out-of-sample transform against a frozen basis is exactly what keeps the layout stable (SC-006). Storing `embeddingModel` in the basis makes a model change self-detecting (id mismatch → refit). `saveData` is the established plugin-managed-state mechanism (002 settings/subscriptions) and keeps the cache separate from 003's record/note store, preserving read-only-over-003.

## 7. Edge construction (OQ-2 resolved)

**Decision**: For each canonical or non-canonical node A with `references`, emit a connection A→B for every `ref ∈ A.references` where `store.has(ref)` is true and `ref !== A.sourceId` (no self-loops). Drop references that don't resolve (dangling, FR-005). Empty/undefined `references` → no edges (OQ-1). Cited-by is never stored (FR-004); if the display needs it, 007 inverts the connection list.

**Rationale**: Exact `PaperSourceId` equality via `has()` is complete for an arXiv-only corpus (spec Clarifications, OQ-2). Self-loop exclusion guards a paper that lists itself. Building only from present references keeps 006 a pure assembler; enrichment/refresh (002/005) fills edges later and a re-run picks them up (eventually consistent, OQ-1).

## 8. Shared `isUncited` relocation (OQ-5 resolved)

**Decision**: Move `isUncited` from `src/services/summarization/isUncited.ts` to a neutral core module `src/models/uncited.ts` (beside `paper.ts`, whose `citationCount`/`citationsKnown` it reads). Update 004's `hook.ts` import to the new path; 006 (and later 007) import the same helper. Behavior is unchanged: `citationsKnown === true && citationCount === 0`.

**Rationale**: The locked cross-feature rule requires one shared uncited helper for 004/006/007 (memory: locked decisions). `src/models/` is owned by no feature and already defines the fields the helper reads, so it is the lowest-coupling home. This is a pure move + import update — a 1-file relocation, verified by 004's existing spec-test still passing.

## 9. Node completeness & the uncited-vs-inbound distinction

**Decision**: Every record with a `publicationYear` becomes a node (SC-001/SC-007), including pending-embedding papers (fallback position). The node carries `citationCount` + `citationsKnown` and the shared uncited flag. 006 never derives "uncited" from in-graph inbound degree — that is a corpus-local quantity distinct from the paper's global citation status (spec Edge Cases). Records missing `publicationYear`, and single malformed records, are skipped without failing the run (FR-002/FR-006).

**Rationale**: 007 must be able to style "uncited" by the authoritative flag, not by inbound edges (a globally-cited paper can have zero in-corpus citers). Carrying both `citationCount` and `citationsKnown` costs nothing (already on `Paper`) and preserves the "confirmed uncited vs not-yet-enriched" distinction (OQ-1).

## Open questions remaining

None. All spec Open Questions (OQ-1..OQ-5) are resolved in spec.md; the implementation decisions above have no unresolved `NEEDS CLARIFICATION`.
