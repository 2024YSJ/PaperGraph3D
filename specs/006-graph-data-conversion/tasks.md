---
description: "Task list for Graph Data Conversion (006)"
---

# Tasks: Graph Data Conversion

**Input**: Design documents from `/specs/006-graph-data-conversion/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/graph-conversion-api.md](./contracts/graph-conversion-api.md), [quickstart.md](./quickstart.md)

**Tests**: No npm test runner is configured (`CLAUDE.md`); verification is skill-driven — a deterministic `specs-test/006-graph-data-conversion/` assert suite (esbuild + node, Obsidian stubbed) plus `tsc --noEmit` + `eslint`, matching 001–005. The spec-test is a committed regression artifact and its scenarios are defined in `quickstart.md`; it is built up per story rather than as a separate TDD phase.

**Organization**: Tasks are grouped by user story (spec.md: User Story 1 = nodes + connections, **P1**; User Story 2 = stable content-similarity layout, **P2**) so each is independently implementable and testable. US1 is the MVP; US2 layers the layout on top.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 (setup, foundational, polish carry no story label)
- File paths are exact, matching `plan.md` § Project Structure and `contracts/graph-conversion-api.md`.

---

## Phase 1: Setup

- [x] T001 Create `src/graph/types.ts` with the 006 output types (`Position`, `GraphNode`, `GraphConnection`, `GraphData`) and the seam interfaces (`GraphReadStore`, `ProjectionBasis`, `BasisCache`) exactly as in [contracts/graph-conversion-api.md](./contracts/graph-conversion-api.md) and [data-model.md](./data-model.md); import `Paper`/`PaperSourceId` from `src/models/paper.ts` (never redefine). Confirm `npm run build` stays green.

## Phase 2: Foundational (blocking prerequisites — complete before US1)

- [x] T002 Relocate the shared uncited helper: create `src/models/uncited.ts` exporting `isUncited` (behavior unchanged: `citationsKnown === true && citationCount === 0`) and delete `src/services/summarization/isUncited.ts` (OQ-5 / FR-012, research.md §8).
- [x] T003 Repoint the existing importers of `isUncited` to `src/models/uncited.ts`: `src/services/summarization/hook.ts` and `specs-test/004-paper-summarization/004-paper-summarization.spec-test.ts`; run the 004 spec-test and confirm it still passes (regression — the only 004 touch is this import path).

## Phase 3: User Story 1 — Produce nodes and connections (Priority: P1) 🎯 MVP

**Goal**: From the stored corpus, produce a correct node list and directional connection list that 007 can consume — no meaningful layout yet (positions come from the deterministic fallback until US2).

**Independent Test**: Feed fixture records (some citing each other, one without a publication year, one citing a non-stored paper) → assert the node list excludes the year-less paper, the connection list matches the citations, and the dangling reference produces no edge and no fabricated node; the call never throws.

- [x] T004 [P] [US1] Implement the deterministic fallback position in `src/graph/fallback.ts` — a pure function `sourceId → Position` (stable string hash → two bounded coordinates in a reserved band outside the projected range), identical across runs (research.md §5, FR-011/SC-007).
- [x] T005 [P] [US1] Implement edge building in `src/graph/edges.ts` — for a node's `references`, emit `{ from, to }` for each `to` where `store.has(to)` is true and `to !== from`; drop dangling references (no fabricated node); empty/undefined `references` → no edges (research.md §7, FR-003/FR-005, OQ-1/OQ-2).
- [x] T006 [US1] Implement node building in `src/graph/nodes.ts` — record → `GraphNode`: exclude records without `publicationYear`; carry `id`/`title`/`publicationYear`/`citationCount`/`citationsKnown`; set `uncited` via `src/models/uncited.ts`; set `position` from `fallback.ts` and `positionSource: 'fallback'` for now; skip malformed records without throwing (FR-001/FR-002/FR-006/FR-012, SC-001/SC-008). Depends on T002, T004.
- [x] T007 [US1] Implement `convertToGraphData(store, basisCache)` in `src/graph/convert.ts` — enumerate `store.all()`, assemble nodes (T006) and connections (T005), set `basisModel`, return `GraphData`; positions are all fallback at this stage (projection wired in US2). Depends on T005, T006.
- [x] T008 [US1] Create `specs-test/006-graph-data-conversion/_obsidian-shim.ts` and `006-graph-data-conversion.spec-test.ts` with the US1 scenarios from [quickstart.md](./quickstart.md) (node-per-record, year-less excluded, malformed skip, A→B directional, dangling drop, no self-loop, cycle, empty-refs, uncited flag = shared rule, read-only/data-only) using fake `GraphReadStore`/`BasisCache`; run via esbuild + node and confirm 0 failed.

**Checkpoint**: US1 delivers a renderable node+edge structure (all nodes at fallback positions) — an independently testable MVP.

## Phase 4: User Story 2 — Compute a stable content-similarity layout (Priority: P2)

**Goal**: Give each canonical-embedding node a deterministic PCA (x,y) so content-similar papers sit near each other, stable as the corpus grows; non-canonical/pending nodes keep the fallback.

**Independent Test**: Convert the same fixtures twice → identical positions; add one canonical paper below the refit threshold → existing nodes unmoved, new node placed on the cached basis; a pending-embedding node keeps a deterministic fallback and is not mixed into the fit.

- [x] T009 [P] [US2] Implement PCA in `src/graph/projection.ts` — fit the top-2 principal components over centered canonical vectors (covariance + deterministic power iteration + deflation, fixed seed/tolerance), apply sign-canonicalization (largest-|component| positive, ties by lowest index), and provide an out-of-sample transform `v → (x,y)` against a stored basis (research.md §3/§4/§6, FR-009).
- [x] T010 [P] [US2] Implement `src/graph/basisCache.ts` — `ProjectionBasis` load/save via the plugin data blob seam (`BasisCache`), plus the refit decision (≥20% canonical-corpus growth since `fitCount` AND ≥25 new canonical papers, or `embeddingModel` mismatch, or explicit recompute); a missing/invalid/mismatched basis triggers a fresh fit (research.md §6, FR-010).
- [x] T011 [US2] Wire projection into `src/graph/convert.ts` — fit/reuse the basis via `basisCache` (T010) + `projection.ts` (T009); project nodes whose `embeddingModel === SPECTER2_EMBEDDING_MODEL` (`positionSource: 'projected'`), leave non-canonical/pending/absent on `fallback.ts` (`positionSource: 'fallback'`); never re-embed; keep existing nodes' positions stable out-of-sample; set `basisModel`. Depends on T007, T009, T010.
- [x] T012 [US2] Extend `006-graph-data-conversion.spec-test.ts` with the US2 layout scenarios from quickstart.md (deterministic exact-equality across runs, content-similarity ordering, out-of-sample stability + no basis re-save below threshold, refit on threshold, fallback determinism + not-mixed-into-fit, no re-embed); confirm 0 failed.

**Checkpoint**: US2 delivers the meaningful, stable similarity layout on top of US1's nodes/edges.

## Phase 5: Polish & Cross-Cutting Concerns

- [x] T013 [P] Write `specs-test/006-graph-data-conversion/report.md` summarizing the suite (PASS counts; record Obsidian-lifecycle / real-`saveData` cases as SKIP with reasons), matching the 001–005 report style.
- [x] T014 Run `npm run build` (`tsc --noEmit` + production esbuild) and `npm run lint`; confirm 0 errors and that the relocated `isUncited` keeps the 004 spec-test green.
- [x] T015 [P] Confirm no `src/graph/*.ts` file exceeds ~300 lines (constitution VI); split by responsibility if any does.

> **Out of scope here (007/008)**: wiring `convertToGraphData` into `main.ts` or a consumer, and persisting the basis through the real `this.saveData` — 006 is invoked on demand and exposes the `BasisCache` seam; the plugin wiring belongs to 007/008 (spec § Out of Scope, plan § Structure Decision).

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → **Phase 3 (US1)** → **Phase 4 (US2)** → **Phase 5 (Polish)**.
- **US1 (P1) is the MVP** and has no dependency on US2. **US2 (P2) depends on US1** (it wires projection into US1's `convert.ts` and node positions).
- T002 (uncited relocation) blocks T006 (node uncited flag). T004 (fallback) blocks T006. T005/T006 block T007. T009/T010 block T011.

## Parallel Opportunities

- **Foundational**: T002 then T003 are sequential (relocate, then repoint importers).
- **US1**: T004 (`fallback.ts`) and T005 (`edges.ts`) are independent → `[P]` together; T006 follows T004+T002; T007 follows T005+T006; T008 (spec-test) follows T007.
- **US2**: T009 (`projection.ts`) and T010 (`basisCache.ts`) are independent → `[P]` together; T011 wires them; T012 (spec-test) follows T011.
- **Polish**: T013 and T015 are `[P]`; T014 (build/lint) runs last.

## Implementation Strategy

1. **MVP = Phases 1–3 (through US1)**: a correct node+edge graph structure (fallback positions) that 007 could already render as an unlaid-out graph, and that fully validates the read-only/exclusion/edge-resolution behavior.
2. **Increment = Phase 4 (US2)**: add the deterministic PCA layout + cached basis; the graph becomes meaningful and stable.
3. **Finish = Phase 5**: report, build/lint, size check.

**Total tasks**: 15 (Setup 1, Foundational 2, US1 5, US2 4, Polish 3).
