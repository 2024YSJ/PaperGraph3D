# Implementation Plan: Graph Data Conversion

**Branch**: `006-graph-data-conversion` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-graph-data-conversion/spec.md`

## Summary

Convert the persisted paper corpus (003 records) into a graph-data structure ready for the 3D view (007): a **node** per paper that has a publication year, **directional citation connections** (A→B when A's `references` contain B's `sourceId`, matched by exact `PaperSourceId` string equality), and a deterministic **2D (x,y) similarity layout** produced by projecting each node's canonical SPECTER2 content embedding with in-process PCA (fixed sign-canonicalization). The publication year is carried per node for 007's fixed year axis, never projected. Conversion is read-only over 003, draws nothing, never re-embeds, and never fails on a single bad record: dangling references drop, malformed records skip, and pending/non-canonical embeddings get a deterministic fallback position. A cached, regenerable **projection basis** keeps the layout stable as the corpus grows (out-of-sample placement; refit only on defined triggers).

## Technical Context

**Language/Version**: TypeScript (`strict: true`), bundled by esbuild into a single `main.js` (constitution I).

**Primary Dependencies**: No new external runtime dependency. Reads 003's `PaperStore` (the `async *all()` enumeration, `get`, `has`). Projection is **in-process linear algebra** — PCA via covariance eigendecomposition / thin power-iteration over the top-2 components of 768-dim SPECTER2 vectors; no heavy ML/projection library (OQ-4, constitution I bundle discipline). The uncited rule is a shared `isUncited` helper relocated to a neutral core module (`src/models/`, FR-012).

**Storage**: Read-only over 003's record/note store (never creates/modifies/deletes a paper record or note). Persists ONE regenerable **projection-basis cache** through the existing plugin data blob (`this.saveData`, the same mechanism 002 settings/subscriptions use) — a plugin-managed artifact separate from paper records, fully regenerable from the corpus if lost. The graph-data output itself is transient (returned to the caller, not persisted).

**Testing**: Skill-driven spec-test under `specs-test/006-graph-data-conversion/` — an esbuild+node `.ts` suite plus `report.md`, deterministic (fixture records; no live network; Obsidian APIs stubbed via the shared obsidian shim), matching the 001–005 convention.

**Target Platform**: Obsidian **desktop** (`isDesktopOnly: true`); in-memory projection is one of the desktop-only capabilities Principle I explicitly allows.

**Project Type**: Obsidian community plugin — single project. 006 is a focused, single-responsibility library module under `src/` (constitution VI); it self-triggers nothing (invoked on demand by 007/008).

**Performance Goals**: Convert a personal-vault corpus (hundreds to low-thousands of papers, 768-dim vectors) in-process without freezing the UI — async and yielding like 002's pipeline. Same input → identical output (deterministic; SC-005).

**Constraints**: Deterministic layout with fixed sign-canonicalization (FR-009/SC-005); read-only over 003 records; **zero network / no external fetch / no code execution** (constitution IV has nothing to disclose here); in-memory; incremental stability via a cached basis with out-of-sample placement (FR-010/SC-006); no user-facing text (constitution V is trivially satisfied — 006 produces data, not UI copy).

**Scale/Scope**: Single-user desktop vault; the corpus fits comfortably in memory (Assumptions).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applies | Assessment |
|-----------|---------|------------|
| I. Obsidian Platform Compliance | Yes | Pure TS under `src/`, bundled by esbuild; no new external runtime dependency, so the single-bundle discipline holds. In-memory 2D projection is a desktop-only capability Principle I explicitly names. **Pass.** |
| II. Lifecycle-Safe Resource Management | N/A | 006 is a stateless conversion library — no event/DOM listeners, no intervals, no timers. Nothing to register or tear down; `main.ts` lifecycle is untouched. **Pass (nothing to manage).** |
| III. Manifest Identity Stability | N/A | Does not touch `manifest.json`/`version`. **Pass.** |
| IV. Transparent Use of Sensitive APIs | Yes | 006 makes **no network request, no external fetch, no dynamic code execution** — it reads local 003 records and computes in-memory. No sensitive-API disclosure is required. **Pass.** |
| V. English-Only UX and Code | Yes | 006 produces a data structure, not user-facing text; code, comments, identifiers, and docs are English. **Pass.** |
| VI. Open-Source Quality & Extensibility | Yes | Logic lives in a focused new module (`src/graph/`), not `main.ts`; the projection is behind a seam so a future UMAP "cluster mode" is additive (OQ-4); relocating `isUncited` to `src/models/` removes cross-feature coupling. Files kept under ~300 lines. **Pass.** |

**Result: PASS — no violations, Complexity Tracking not required.**

**Post-design re-check (after Phase 1):** the design (research.md, data-model.md, contracts/, quickstart.md) introduces no network call, no external fetch, no dynamic execution, no user-facing text, and no new external runtime dependency — projection is in-process and the only persisted artifact is a regenerable cache via the existing `saveData` mechanism. All gates still **PASS**; no new complexity to justify.

## Project Structure

### Documentation (this feature)

```text
specs/006-graph-data-conversion/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (module API contract)
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── models/
│   ├── paper.ts              # 001 — Paper shape (read-only consumer)
│   └── uncited.ts            # NEW: relocated shared isUncited helper (FR-012);
│                             #      004's hook.ts import updated to point here
├── persistence/
│   └── store.ts              # 003 — PaperStore.all()/get/has (read-only consumer)
├── collection/
│   └── localTransformer.ts   # 002 — SPECTER2_EMBEDDING_MODEL / _DIM (read-only import)
└── graph/                    # NEW: this feature
    ├── types.ts              # 006 output types (GraphNode/GraphConnection/GraphData/Position)
    │                         #   + seam interfaces (GraphReadStore/ProjectionBasis/BasisCache)
    ├── convert.ts            # entry: corpus -> GraphData (nodes, connections, positions)
    ├── nodes.ts              # record -> node (year gate, uncited flag, carried fields)
    ├── edges.ts              # references -> directional connections (exact-id match, dangling drop)
    ├── projection.ts         # PCA basis fit + out-of-sample transform + sign-canonicalization
    ├── fallback.ts           # deterministic fallback position for pending/non-canonical nodes
    └── basisCache.ts         # regenerable projection-basis cache (via plugin saveData)

specs-test/006-graph-data-conversion/
├── 006-graph-data-conversion.spec-test.ts
├── _obsidian-shim.ts
└── report.md
```

**Structure Decision**: Single-project Obsidian plugin. 006 adds one cohesive `src/graph/` module (split by responsibility — nodes, edges, projection, fallback, basis cache — so no file approaches the ~300-line limit) plus a one-time relocation of `isUncited` into `src/models/`. It consumes 001 (`Paper`), 003 (`PaperStore`), and 002's SPECTER2 constants strictly read-only, and touches `main.ts` only if a caller wiring is needed (deferred to 007/008). No changes to 002/003 internals.

## Complexity Tracking

> No Constitution Check violations — this section is intentionally empty.
