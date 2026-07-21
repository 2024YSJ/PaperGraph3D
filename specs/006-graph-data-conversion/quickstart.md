# Quickstart: Validating Graph Data Conversion

Purpose: prove `src/graph/` turns a set of stored records into correct, deterministic graph data — **without** a test framework, a live network, or a real Obsidian app — by driving `convertToGraphData` (see [contracts/graph-conversion-api.md](./contracts/graph-conversion-api.md)) against in-memory fixture records and fake seams. Runs the same way as the 001–005 spec-tests (esbuild + node, deterministic).

## Prerequisites

- `npm install` has been run; `npm run build` passes (`tsc --noEmit` clean, production bundle).
- The 006 modules exist under `src/graph/` and `isUncited` has been relocated to `src/models/uncited.ts` (004's import updated) — see [plan.md](./plan.md) § Project Structure.
- The imported seams are present: `Paper` (001), `PaperStore.all()/has()` (003), `SPECTER2_EMBEDDING_MODEL`/`_DIM` (002).

## Setup

A `specs-test/006-graph-data-conversion/` suite that builds fixture `Paper` records and drives conversion against fakes:

- A **fake `GraphReadStore`** over an array of fixture papers: `all()` yields them; `has(id)` checks the fixture id set.
- A **fake `BasisCache`** holding one in-memory `ProjectionBasis | undefined` so fit/refit and out-of-sample paths are exercised without `saveData`.
- Fixture papers spanning every branch: canonical-embedding papers that cite each other, a paper with **no `publicationYear`** (must be excluded), a paper citing a **non-stored** id (dangling), a paper with a **baseline/pending** embedding (fallback), a self-citing paper (no self-loop), and a citation cycle (A↔B).

Run via esbuild + node with the obsidian shim alias, e.g.:

```bash
npx esbuild specs-test/006-graph-data-conversion/006-graph-data-conversion.spec-test.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./specs-test/006-graph-data-conversion/_obsidian-shim.ts \
  --outfile=<scratch>/006.cjs && node <scratch>/006.cjs
```

## Scenarios to assert (maps to spec)

### Nodes & exclusion (US1)

- **Node per record with a year** (FR-001/FR-002, SC-001): N fixture papers with years → N nodes; each node carries title + `publicationYear` read from the record, never from a note body.
- **Year-less excluded** (FR-002): a record with `publicationYear: undefined` produces no node; node count = (records − year-less − malformed).
- **Malformed skip, never fail** (FR-006, SC-003): a record missing required fields is skipped and the rest still convert; the call resolves, never throws.

### Edges (US1)

- **A cites B → A→B** (FR-003, SC-002): fixture where A.references includes B.sourceId and B is stored → exactly one `{from: A, to: B}`; no reverse edge (directional, FR-004).
- **Dangling dropped** (FR-005): A cites an id not in the store → no connection, no fabricated node, call succeeds.
- **No self-loop**: A.references includes A.sourceId → no `{from: A, to: A}`.
- **Cycle**: A↔B references → both `{A,B}` and `{B,A}` present; no infinite loop.
- **Empty references → no edges** (OQ-1): A.references empty/undefined → zero edges for A; A's node still carries `citationsKnown` so the enriched-vs-uncited distinction survives.

### Layout (US2)

- **Deterministic** (FR-009, SC-005): convert the same fixtures twice with the same basis → identical `position` for every node (no mirror-flip). Assert exact equality.
- **Content-similarity ordering** (SC-005): two near-identical embeddings land measurably closer in (x,y) than a deliberately orthogonal one.
- **Out-of-sample stability** (FR-010, SC-006): after a first fit, add one canonical paper below the refit threshold → existing nodes' positions are byte-identical; the new node is placed via the cached basis (`positionSource: 'projected'`), and `basisCache.save` was **not** called again.
- **Refit trigger** (FR-010): cross the ≥20% + ≥25-paper threshold → a new basis is fit and saved; `basisModel` unchanged (same SPECTER2 id).

### Fallback & pending (US2 / FR-011)

- **Fallback position** (FR-011, SC-007): a paper with a baseline/absent/`undefined` embedding → a node with `positionSource: 'fallback'`, finite deterministic `position` (identical across two runs), never dropped, and **not** mixed into the PCA fit (removing it does not change other nodes' projected positions).
- **No re-embed**: conversion never calls any embedding routine; a pending node stays at fallback until its record's `embeddingModel` becomes canonical (simulated by flipping the fixture), after which a re-run projects it.

### Uncited flag (FR-012 / SC-008)

- **Shared rule** (SC-008): `uncited === isUncited(paper)` for every node — `citationsKnown && citationCount === 0`; a `citationsKnown: false, citationCount: 0` paper is **not** uncited; a globally-cited paper with zero in-corpus inbound edges is **not** marked uncited (flag ≠ inbound degree).

### Read-only & data-only (SC-004 / FR-007)

- The fake store exposes only `all()`/`has()`; assert conversion never invokes a write path and returns only `GraphData` (nodes/connections/basisModel) — no rendering, no note/record mutation.

## Out of scope for this guide

- Real Obsidian `saveData` persistence of the basis (covered by the plugin wiring in 007/008; the spec-test uses the in-memory `BasisCache` fake).
- On-screen rendering (007).
- Live SPECTER2 embedding (002; fixtures supply vectors directly).
