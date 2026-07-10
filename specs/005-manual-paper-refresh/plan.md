# Implementation Plan: Manual Paper Refresh

**Branch**: `develop-feature/005-manual-paper-refresh` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-manual-paper-refresh/spec.md`

## Summary

Re-fetch up-to-date citation and content information for one already-saved paper (FR-001) — its citation count, its own outbound references, and its title/abstract/authors (in case arXiv has served a newer revision) — writing the result through 003's existing synchronized JSON+Markdown pairing and never touching the user's hand-written body. A second, batched action (FR-009) refreshes every saved paper whose `publicationYear` is the current or immediately preceding calendar year in one user-triggered run, using Semantic Scholar's batch endpoint for citation lookups and a short, adaptively-backing-off pace for arXiv's per-paper content re-fetch. Both modes share one concurrency guard, one summary-regeneration decision (004 is re-invoked when the abstract changed or the paper's citation status crossed the uncited/cited boundary — FR-014/FR-020), and one content-change-triggered embedding recomputation: when a refresh changes a paper's title/abstract, this feature recomputes the canonical embedding by composing 002's already-implemented, already-exported embedding functions (`computeBaselineEmbedding`, `upgradeEmbedding` — 002 FR-044/045/046) rather than implementing any embedding logic of its own (FR-019). The two providers' calls are independent per paper: a citation-lookup failure never fails an otherwise-successful content refresh (FR-021). A running bulk refresh can be cancelled by the user; the guard mediates this the same way it mediates single-vs-bulk overlap — the in-flight paper finishes, no further paper is touched, and the guard releases immediately (FR-022). This feature makes no external call of its own kind and computes no embedding math of its own — it exclusively reuses 002's already-implemented arXiv/Semantic Scholar clients (extended with one new single-ID arXiv lookup function) and embedding functions, plus 003's `PaperStore`.

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: No new dependency. Reuses `obsidian`'s `requestUrl` transitively through 002's existing `arxivClient.ts`/`semanticScholarClient.ts` (this feature adds one new exported function, `fetchArxivEntryById`, to `arxivClient.ts`). Reuses 002's already-implemented, dependency-free embedding modules (`src/collection/embedding.ts` — a deterministic hashed-term-frequency baseline; `src/collection/embeddingUpgrade.ts` — the local-transformer/LLM upgrade dispatch) unchanged. Reuses 003's `PaperStore` (`src/persistence/store.ts`) for all writes and 001's `Paper`/`PaperSourceId`/`EmbeddingProvider` types.

**Storage**: No new persisted shape. Refresh writes go through the existing `PaperStore.upsert`/`PersistInput` (003) — the same `.json` record + `.md` note pairing 002 already writes through. All in-memory state (concurrency guard, bulk-run progress/failure list) is transient and never survives past one refresh action (spec Key Entities).

**Testing**: No test runner is configured in this repo (`CLAUDE.md`), consistent with 001/002/003. Verification is (a) `tsc --noEmit` strict type-checking (gates `npm run build`), (b) `eslint .`, and (c) a manual `quickstart.md` walkthrough run via the existing `esbuild`+`node` scratch-script pattern, using stubbed arXiv/Semantic Scholar provider functions plus 002's real (already offline, already deterministic) embedding functions and 003's `InMemoryFileStore` fake — no live network call.

**Target Platform**: Obsidian desktop (project is desktop-only per constitution/manifest). This feature's own code has no desktop-only dependency of its own (it only calls `requestUrl`/`DOMParser`, both mobile-compatible, and 002's embedding functions, which are pure computation); it simply runs within the desktop-only plugin.

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (single-project layout; new code under `src/refresh/`, one extension to existing `src/collection/arxivClient.ts`).

**Performance Goals**: A 100+ paper bulk refresh completes in well under the naive 5-minute (3 s/paper) figure absent sustained rate-limiting (SC-007) — the ~300 ms default per-paper arXiv-content pacing (research.md Decision 4) keeps that leg to roughly 30 s for 100 papers, and citation lookups cost one (or a few, chunked) batched request rather than N individual ones (SC-011). Bulk processing must never freeze the interface (FR-010) — achieved by awaiting a per-paper delay between sequential `refreshOne` calls, the same non-blocking sequential pattern 002's `runCollectionPass`/`reembedCorpus` already use. Embedding recomputation adds negligible latency per refreshed paper — `computeBaselineEmbedding` is a synchronous, dependency-free hashed-term-frequency computation over title+abstract-length text (002's own design choice for exactly this reason).

**Constraints**: Must not depend on Node/Electron-only networking (constitution Principle I; matches 002's existing choice of `requestUrl`/`DOMParser`); every network call is disclosed per constitution Principle IV — this feature adds no *new* disclosed capability, since it reuses the same two providers 002 already discloses (README/settings copy MUST be updated to mention refresh as a second trigger of those same calls); MUST route all external communication through 002's existing client modules (FR-008), never a new client; MUST NOT implement any embedding computation of its own (FR-019) — always composes 002's exported `computeBaselineEmbedding`/`upgradeEmbedding`; MUST NOT introduce a new persisted field for staleness/versioning (spec Assumptions); `tsc --noEmit` and `eslint .` must keep passing repo-wide.

**Scale/Scope**: A handful of new modules under a new `src/refresh/` directory (`types.ts`, `concurrencyGuard.ts`, `summaryTrigger.ts`, `embeddingRecompute.ts`, `refreshOne.ts`, `bulkRefresh.ts`) plus one new exported function (`fetchArxivEntryById`) added to the existing `src/collection/arxivClient.ts`. No existing 001/002/003 file's exported shape is changed — only additive. Each new file stays well under the constitution's ~300-line split guidance.

**Dependency note**: At planning time this feature's branch sat 11 commits behind `develop`, predating 002's embedding work (`src/collection/embedding.ts`, `embeddingUpgrade.ts`, `reembed.ts`, and 001/002's `FR-019`–`FR-046` embedding requirements). Merging onto `develop` before implementation was a hard prerequisite — tracked as tasks.md's T001, **completed 2026-07-10** via `git merge develop` (merge commit `83728c7`, no conflicts). `computeBaselineEmbedding`/`upgradeEmbedding`/`EmbeddingConfig` are now present on this branch.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | All networking goes through 002's existing `requestUrl`-based clients (extended with one new function using the same pattern) and `DOMParser` — no Node/Electron-only API. Embedding computation is pure TypeScript (no Node/Electron API either). **Pass.** |
| II. Lifecycle-Safe Resource Management | Applies (NON-NEGOTIABLE) | This feature registers no listener, interval, or timer of its own outside the request-pacing `setTimeout`-based `delay()` already used identically by 002's clients (a plain awaited promise, not a persistent timer). **Pass.** |
| III. Manifest Identity Stability | N/A | `manifest.json` is not touched by this feature. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies | Reuses two already-disclosed network providers (arXiv, Semantic Scholar) and 002's already-disclosed embedding providers (bundled baseline offline; local-transformer on-device; LLM stubbed until 004) rather than adding a new one; the disclosure copy (README/settings) MUST be updated to state that a manual refresh action, not only subscription collection, can trigger these calls — tracked as a tasks.md deliverable. **Pass, with a documentation obligation carried into tasks.md.** |
| V. Bilingual UX, English-Only Code | Applies | User-facing failure/progress messages (not-found, provider error, bulk-already-running, bulk progress) MUST be understandable to both Korean- and English-speaking users; all code/comments stay English. **Pass — carried into UX copy tasks.** |
| VI. Open-Source Code Quality & Extensibility | Applies | New logic lives in a dedicated `src/refresh/` directory, one responsibility per file, extending (not forking) 002's provider/embedding clients and 003's `PaperStore` rather than duplicating either. `computeCanonicalEmbedding` composes two already-exported 002 functions rather than reimplementing embedding math (research.md Decision 9) — the clearest instance of this principle in this feature's design. **Pass.** |

No violations identified. Complexity Tracking table below is not needed.

**Post-Phase-1 re-check**: `research.md`, `data-model.md`, `contracts/refresh-api.md`, and `quickstart.md` were reviewed against the same six principles after design. The concurrency guard (research.md Decision 3) introduces no timer or listener (II); `fetchArxivEntryById` and the reused Semantic Scholar clients are the only network call sites (I/IV); the embedding recomputation path (Decision 9) makes zero additional network calls of its own — `computeBaselineEmbedding` is pure/offline and `upgradeEmbedding`'s only non-offline path (`llm`) is presently a no-op stub inside 002 itself, not something this feature adds; `refreshOne.ts`/`bulkRefresh.ts`/`summaryTrigger.ts`/`concurrencyGuard.ts`/`embeddingRecompute.ts` are each single-responsibility and import 002/003's existing exports rather than re-implementing them (VI). All six principles remain satisfied; no new violations were introduced by the detailed design.

## Project Structure

### Documentation (this feature)

```text
specs/005-manual-paper-refresh/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/
│   └── refresh-api.md   # Phase 1 output (/speckit-plan command)
├── checklists/
│   └── requirements.md  # spec quality checklist (pre-existing)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                       # existing — untouched here; 008 wires refresh commands/menu items
├── models/                       # 001 — reused, untouched (Paper/PaperSourceId, EmbeddingProvider, PluginSettings.embeddingProvider/localEmbeddingModel)
├── collection/                   # 002 — reused; ONE new export added
│   ├── arxivClient.ts             # gains fetchArxivEntryById (id_list= single-paper lookup, research.md Decision 1) — existing queryArxiv untouched
│   ├── semanticScholarClient.ts   # UNCHANGED — fetchSemanticScholarPaper (single) and fetchSemanticScholarBatch (bulk) already exist
│   ├── semanticScholarParser.ts   # UNCHANGED — parseSemanticScholarPaper, toPaperSourceId
│   ├── arxivParser.ts             # UNCHANGED — parseArxivEntry reused against the one <entry> fetchArxivEntryById returns
│   ├── types.ts                   # UNCHANGED — SummarizationInput/SummaryResult imported by refresh/types.ts (FR-017)
│   ├── embedding.ts                # UNCHANGED (already on develop, needs merge) — computeBaselineEmbedding, EmbeddingResult (002 FR-044)
│   └── embeddingUpgrade.ts         # UNCHANGED (already on develop, needs merge) — upgradeEmbedding, EmbeddingConfig (002 FR-045/046)
├── persistence/                  # 003 — reused, untouched (PaperStore.get/all/upsert)
└── refresh/                      # NEW — this feature's entire footprint
    ├── types.ts                   # RefreshOutcome, RefreshHooks (summarize), BulkRefreshResult, re-exported EmbeddingConfig
    ├── concurrencyGuard.ts        # shared in-flight Set + bulk-running flag (FR-006/FR-012, research.md Decision 3)
    ├── summaryTrigger.ts          # shouldRegenerateSummary pure predicate (FR-014 ∨ FR-020, research.md Decision 5)
    ├── embeddingRecompute.ts      # computeCanonicalEmbedding — composes 002's computeBaselineEmbedding/upgradeEmbedding (FR-019, research.md Decision 9)
    ├── refreshOne.ts              # single-paper refresh orchestration (FR-001–FR-006, FR-013, FR-014, FR-017, FR-019, FR-020); also the per-paper unit bulkRefresh.ts calls
    └── bulkRefresh.ts             # bulk orchestration: window selection via store.all() (FR-009, research.md Decision 10), batched citation lookup (FR-018), sequential paced per-paper refreshOne calls (FR-015), progress (FR-016), failure summary (FR-011), bulk-vs-bulk guard (FR-012)
```

**Structure Decision**: Single project (no frontend/backend split), matching 001/002/003's precedent. All new orchestration logic lives under a new `src/refresh/` directory, one responsibility per file per constitution Principle VI. Two existing files are touched, both additively: `src/collection/arxivClient.ts` gains one new exported function (`fetchArxivEntryById`); no 002/003 embedding or persistence export changes at all. `src/main.ts` is untouched by this feature (spec Out of Scope: the on-screen trigger belongs to 007/008); `refreshOne.ts`/`bulkRefresh.ts` expose plain async functions 008 calls from a command/menu handler, mirroring how 002's `scheduler.ts` exposes `{ checkNow, backfillNow }` for the same kind of external wiring, and how 002's own `reembedCorpus` is invoked by whichever settings-change handler wires it.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
