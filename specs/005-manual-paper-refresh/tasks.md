---

description: "Task list for Manual Paper Refresh (005)"
---

# Tasks: Manual Paper Refresh

**Input**: Design documents from `/specs/005-manual-paper-refresh/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/refresh-api.md](./contracts/refresh-api.md), [quickstart.md](./quickstart.md)

**Tests**: No test runner is configured in this repo (`CLAUDE.md`), consistent with 001/002/003. Tests are not requested for this feature — verification is `tsc --noEmit` + `eslint .` + a manual `quickstart.md` walkthrough, referenced as checkpoint tasks per story rather than a separate TDD test phase.

**Organization**: Tasks are grouped by user story (spec.md: User Story 1 = single-paper refresh, P3; User Story 2 = bulk refresh, P4) so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- File paths are exact, matching `plan.md`'s Project Structure and `contracts/refresh-api.md`'s signatures.

## Path Conventions

Single project (Obsidian plugin, one esbuild bundle). All new code under `src/refresh/`; one existing file extended: `src/collection/arxivClient.ts`.

---

## Phase 1: Setup

**Purpose**: Bring this branch up to date with 002's already-merged embedding modules, and create this feature's module directory.

- [x] T001 Merge or rebase `develop-feature/005-manual-paper-refresh` onto `develop` so `src/collection/embedding.ts`, `src/collection/embeddingUpgrade.ts`, `src/collection/reembed.ts`, and `src/models/settings.ts`'s `embeddingProvider`/`localEmbeddingModel` fields become available on this branch (plan.md Technical Context: 11 commits behind at planning time). Resolve any conflicts by keeping `develop`'s embedding code untouched — this feature only adds new files/one new export, it never modifies embedding internals. **Completed 2026-07-10** via `git merge develop` (merge commit `83728c7`), no conflicts.
- [x] T002 Create the `src/refresh/` directory (no build config changes needed — esbuild already bundles everything under `src/`)

**Checkpoint**: `npm run build` succeeds with zero changes yet under `src/refresh/`, confirming the embedding modules are present and nothing existing broke.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, the concurrency guard, the summary-regeneration predicate, the embedding-recomputation composer, and the one new arXiv lookup function — every later task in both user stories depends on these.

**⚠️ CRITICAL**: No user-story task may begin until this phase is complete.

- [x] T003 [P] Create `src/refresh/types.ts` — `RefreshOutcome` (`updated` / `notFound` / `alreadyInFlight` / `error`), `RefreshHooks` (`summarize?` reusing `SummarizationInput`/`SummaryResult` from `src/collection/types.ts`), `BulkRefreshResult` (`matchedCount`, `failures: { sourceId: PaperSourceId; reason: string }[]`), and a re-exported `EmbeddingConfig` type (from `src/collection/embeddingUpgrade.ts`) — per contracts/refresh-api.md § types.ts
- [x] T004 [P] Create `src/refresh/concurrencyGuard.ts` — `createConcurrencyGuard()` returning `{ claimSingle, releaseSingle, claimBulk, releaseBulk, claimForBulkItem, releaseForBulkItem, requestBulkCancel, isBulkCancelRequested }` backed by one shared `Set<PaperSourceId>` (single + bulk-item claims share it, FR-006/FR-012), one `bulkActive` boolean, and one `bulkCancelRequested` boolean that `releaseBulk` clears alongside `bulkActive` (FR-022) — per contracts/refresh-api.md § concurrencyGuard.ts, research.md Decisions 3/12
- [x] T005 [P] Create `src/refresh/summaryTrigger.ts` — pure `shouldRegenerateSummary(stored: Paper, fresh: { abstract: string; citationCount: number; citationsKnown: boolean }): boolean` implementing FR-014 ∨ FR-020: regenerate when `fresh.abstract !== stored.abstract` **OR** `isUncited(stored) !== isUncited(fresh)`, where `isUncited(p) = p.citationsKnown === true && p.citationCount === 0` — the confirmed-zero predicate of 001/002 FR-018, **not** a bare `citationCount === 0` — per contracts/refresh-api.md § summaryTrigger.ts, research.md Decision 5, data-model.md § State transition
- [x] T006 [P] Create `src/refresh/embeddingRecompute.ts` — `computeCanonicalEmbedding(title, abstract, config: EmbeddingConfig): Promise<EmbeddingResult>` composing 002's already-exported `computeBaselineEmbedding` (`src/collection/embedding.ts`) and `upgradeEmbedding` (`src/collection/embeddingUpgrade.ts`): when `config.provider === 'bundled'` return `computeBaselineEmbedding(title, abstract)` directly; otherwise call `upgradeEmbedding(title, abstract, config)` and fall back to `computeBaselineEmbedding` when it returns `undefined` — per contracts/refresh-api.md § embeddingRecompute.ts, research.md Decision 9. Do NOT import from `src/collection/reembed.ts` (research.md Decision 9's Alternatives — different trigger/shape).
- [x] T007 [P] Add `fetchArxivEntryById(baseArxivId: string): Promise<Element | undefined>` to `src/collection/arxivClient.ts` — queries `id_list=<id>` (no window/paging), reuses the existing `DOMParser` Atom-parsing pattern already in this file, returns the one matched `<entry>` or `undefined` when arXiv has none — per contracts/refresh-api.md § arxivClient.ts (extended), research.md Decision 1

**Checkpoint**: `tsc --noEmit` passes with these five additions; nothing yet calls them.

---

## Phase 3: User Story 1 - Refresh a single saved paper on demand (Priority: P3) 🎯 MVP

**Goal**: A user can pick one already-saved paper and refresh its citation count, references, title/abstract/authors, summary/future-directions text, and content embedding — writing through 003's existing pairing without touching the user's hand-written body.

**Independent Test**: Per spec.md's own Independent Test for US1 — save a paper with known citation count/abstract, refresh it against a stubbed provider returning higher citations, updated relationships, and a changed abstract; confirm record + note managed region reflect the new values, the summary/future-directions text and embedding are regenerated because the abstract changed, and the user's body text is unchanged. Verified by quickstart.md Scenarios 1, 1b, 1c, 1d, 2, 3, 3b, 3c, 4.

### Implementation for User Story 1

- [x] T008 [US1] Implement the guard + not-in-store short-circuit in `src/refresh/refreshOne.ts`: `store.get(sourceId)` first — `undefined` returns `{ status: 'notFound' }` immediately with no provider call (FR-021); then, unless `options.alreadyClaimed`, call `guard.claimSingle(sourceId)` — `false` returns `{ status: 'alreadyInFlight' }` (FR-006) — per contracts/refresh-api.md § refreshOne.ts steps 0–1, data-model.md § RefreshOutcome
- [x] T009 [US1] Implement the arXiv content re-fetch step in `refreshOne.ts`: call `fetchArxivEntryById` (T007) on the sourceId's version-stripped base id, map the returned `<entry>` through the existing `parseArxivEntry`-equivalent logic; no entry → release the guard, return `{ status: 'notFound' }` (FR-005); an entry always overwrites stored title/abstract/authors unconditionally, no version comparison (FR-013). Do NOT copy the re-fetched candidate's `publicationYear` onto the updated `Paper` — carry the stored `publicationYear` through unchanged (FR-002; it is the FR-009 window key); the parsed year may be `undefined` (`arxivParser.ts` yields `publicationYear: number | undefined`) and must never overwrite the stored value or fail `isValidPaper`
- [x] T010 [US1] Implement the citation lookup step in `refreshOne.ts`: when `options.citationOverride` is not supplied (single-paper mode), call `fetchSemanticScholarPaper`; on success, update `citationCount`/`references`/`citationsKnown = true` (FR-002); on failure/no-record, leave `citationCount`/`references`/`citationsKnown` exactly as previously stored — this is **not** a refresh failure, `status` stays on track for `'updated'` (FR-021, data-model.md § Independent provider failure)
- [x] T011 [US1] Implement the embedding recomputation step in `refreshOne.ts` (FR-019): compare the freshly-fetched title/abstract against the stored `Paper`'s; if either changed, call `computeCanonicalEmbedding` (T006) with `getEmbeddingConfig()` (read live) and apply its `embedding`/`embeddingModel`/`embeddingSource` onto the `Paper`; if unchanged, carry the stored embedding fields through unmodified — per contracts/refresh-api.md § refreshOne.ts step 5, research.md Decision 9
- [x] T012 [US1] Implement the summary-regeneration step in `refreshOne.ts`: call `summaryTrigger.shouldRegenerateSummary` (T005) against the previously-stored `Paper` and the **effective** `{ abstract, citationCount, citationsKnown }` — the fetched citation values when Semantic Scholar supplied data this call, or the **carried-through stored** `citationCount`/`citationsKnown` when the lookup was unavailable (FR-021), so an unavailable lookup never triggers a spurious regeneration while a `citationsKnown false→true` confirmation at count 0 (un-enriched → confirmed-uncited, FR-020) does trigger one; if it returns true **and** `isSummarizationEnabled()` is true (read live), call `hooks.summarize` with the narrow `{ title, abstract, citationCount, citationsKnown }` shape (FR-017); re-check `isSummarizationEnabled()` after the call resolves and discard the result if now false (FR-014's in-flight-discard, mirroring 002 FR-021)
- [x] T013 [US1] Implement the persist + guard-release tail in `refreshOne.ts`: call `store.upsert({ paper: <updated Paper>, summary, futureDirections })` (003), release the guard (`releaseSingle` unless `options.alreadyClaimed`), and return `{ status: 'updated' }`; wrap the arXiv/citation calls' unexpected exceptions so they release the guard and return `{ status: 'error'; message }` rather than leaving the guard claimed (FR-005 pairing-never-partially-updated guarantee). The `store.upsert` call MUST target only the refreshed `sourceId` — no other paper's record is read or written by this function (FR-004).
- [x] T014 [US1] Wire `refreshOne`'s exported signature exactly per contracts/refresh-api.md § refreshOne.ts: `(store, sourceId, guard, hooks, isSummarizationEnabled, getSemanticScholarApiKey, getEmbeddingConfig, options?: { alreadyClaimed?: boolean; citationOverride?: { citationCount: number; references: PaperSourceId[] } | 'unavailable' })`, threading `getSemanticScholarApiKey()` into the single-paper `fetchSemanticScholarPaper` call (T010), `getEmbeddingConfig()` into the embedding step (T011), and `citationOverride` (when supplied by bulk) bypassing the citation call entirely

**Checkpoint**: Run quickstart.md Scenarios 1, 1b, 1c, 1d, 2, 3, 3b, 3c, 4 against stubbed `fetchArxivEntryById`/`fetchSemanticScholarPaper`, 002's real (offline) embedding functions, and 003's `InMemoryFileStore`. User Story 1 is fully functional and independently testable — `npm run build` and `npm run lint` pass.

---

## Phase 4: User Story 2 - Refresh all recent papers in one action (Priority: P4)

**Goal**: A user can trigger, in one action, a refresh of every saved paper published within the last year — batching citation lookups, pacing arXiv content re-fetches, showing progress, and surfacing failures as one summary without aborting the run.

**Independent Test**: Per spec.md's own Independent Test for US2 — save papers with a mix of publication years, trigger bulk refresh, confirm only papers within the last year were re-checked, processed sequentially at a pace well under the naive 3s/paper figure with visible progress, while older papers and unrelated notes are untouched; separately, cancel a run mid-way and confirm already-processed papers keep their updates, unreached papers are untouched, and a new run can start immediately (FR-022). Verified by quickstart.md Scenarios 5, 6, 7.

### Implementation for User Story 2

- [x] T015 [US2] Implement candidate selection in `src/refresh/bulkRefresh.ts`: acquire `guard.claimBulk()` — `false` returns `{ status: 'alreadyRunning' }` immediately (FR-012); otherwise enumerate `store.all()` (003) and collect every `Paper` with `publicationYear >= currentYear - 1` (FR-009, research.md Decisions 10/11) into the `matched` list
- [x] T016 [US2] Implement the one batched citation lookup in `bulkRefresh.ts`: call `fetchSemanticScholarBatch` (`src/collection/semanticScholarClient.ts`, already chunked to 500 ids/request) once for every matched paper's sourceId, threading `getSemanticScholarApiKey()`; build a per-sourceId `citationOverride` map from the response, mapping a missing/failed element to `'unavailable'` (FR-018)
- [x] T017 [US2] Implement the paced sequential per-paper loop in `bulkRefresh.ts`: for each matched paper, `guard.claimForBulkItem(sourceId)` (skip — do not count as failure — if a concurrent single refresh already holds it, FR-012), call `refreshOne(store, sourceId, guard, hooks, isSummarizationEnabled, getSemanticScholarApiKey, getEmbeddingConfig, { alreadyClaimed: true, citationOverride: <from T016> })`, release the bulk-item claim after it resolves, then await the FR-015 pacing delay (default 300ms fixed, doubling on the previous paper's `'error'` outcome up to a 3s cap, resetting to 300ms after a subsequent success, per research.md Decision 4) before the next paper
- [x] T018 [US2] Implement progress reporting and failure accumulation in `bulkRefresh.ts`: after each per-paper `refreshOne` call settles, call `onProgress?.(done, matched.length)` (FR-016) and, when the outcome is `'notFound'` or `'error'`, push `{ sourceId, reason }` onto the run's `failures` list (FR-011) — a per-paper failure must not stop the loop
- [x] T019 [US2] Implement cancellation in `bulkRefresh.ts` (FR-022): immediately after each per-paper `refreshOne` call settles (T018) and before the pacing delay (T017)/next iteration, check `guard.isBulkCancelRequested()` — if true, break the loop right there so the just-finished paper's update stands and no further paper is touched (research.md Decision 12)
- [x] T020 [US2] Implement the guard release + result tail in `bulkRefresh.ts`: after the loop completes (normally or via T019's cancellation break), release `guard.releaseBulk()` (which also clears the cancel-requested flag) and return `{ matchedCount: matched.length, failures }` — per contracts/refresh-api.md § bulkRefresh.ts, data-model.md § BulkRefreshRun
- [x] T021 [US2] Wire `runBulkRefresh`'s exported signature exactly per contracts/refresh-api.md § bulkRefresh.ts: `(store, guard, hooks, isSummarizationEnabled, getSemanticScholarApiKey, getEmbeddingConfig, onProgress?)` returning `Promise<BulkRefreshResult | { status: 'alreadyRunning' }>`

**Checkpoint**: Run quickstart.md Scenarios 5, 6, 7 against the same stubs plus a stubbed `fetchSemanticScholarBatch`. Both user stories are independently functional — `npm run build` and `npm run lint` pass.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Documentation obligations and final full-feature verification.

- [x] T022 Review every user-facing message string produced by `src/refresh/` (not-found, provider-error, already-in-progress/already-in-flight, bulk-cancelled, progress text) and ensure each is bilingual (Korean + English) or plain, translation-friendly English per constitution Principle V — matching 002's existing failure-notice copy style; this was flagged in plan.md's Constitution Check § V ("carried into UX copy tasks") but had no dedicated task until now
- [x] T023 Update `README.md` (and/or settings UI copy, per whichever surfaces provider disclosure today) per constitution Principle IV: state that a manual refresh action, not only subscription collection, can trigger arXiv/Semantic Scholar calls — this feature reuses already-disclosed providers but adds a second trigger of them (plan.md Constitution Check § IV)
- [x] T024 Run the full `quickstart.md` walkthrough (all scenarios: 1, 1b, 1c, 1d, 2, 3, 3b, 3c, 4, 5, 6, 7) end-to-end via the project's `esbuild`+`node` scratch-script pattern, confirming zero live network calls are made and that embedding recomputation uses 002's real functions correctly
- [x] T025 Run `npm run build` (`tsc --noEmit` + production bundle) and `npm run lint` across the whole repo to confirm no regression outside `src/refresh/`/`src/collection/arxivClient.ts`; also confirm (per FR-007) that no file under `src/refresh/` registers a timer/interval — grep for `registerInterval`/`setInterval` returns zero matches, consistent with this feature being manual-only

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately. T001 (rebase onto `develop`, now complete) had to precede T002 and any later task, since Phase 2 imports embedding modules that did not exist on this branch pre-merge.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS** both user stories — `types.ts` (T003) is imported by every later task; `concurrencyGuard.ts` (T004) is used by both `refreshOne.ts` and `bulkRefresh.ts`; `summaryTrigger.ts` (T005) and `embeddingRecompute.ts` (T006) are used by `refreshOne.ts`; `fetchArxivEntryById` (T007) is called by `refreshOne.ts`.
- **User Story 1 (Phase 3)**: Depends on Foundational only. Delivers the MVP on its own.
- **User Story 2 (Phase 4)**: Depends on Foundational **and** on User Story 1's `refreshOne.ts` (T008–T014) being complete — `bulkRefresh.ts` calls `refreshOne` directly as its per-paper unit (spec.md Key Entities). This is the one cross-story dependency in this feature; US2 is not implementable before US1's `refreshOne` exists.
- **Polish (Phase 5)**: Depends on both user stories being complete.

### Within Each User Story

- T008 → T009 → T010 → T011 → T012 → T013 → T014 are sequential — all within the same file (`refreshOne.ts`), each step building on the previous step's updated `Paper` shape.
- T015 → T016 → T017 → T018 → T019 → T020 → T021 are sequential — all within the same file (`bulkRefresh.ts`), same reasoning; T017 additionally depends on all of User Story 1's tasks (T008–T014) being complete, since it calls `refreshOne`.

### Parallel Opportunities

- T003, T004, T005, T006, T007 (Phase 2) touch five different files with no dependency on each other — run all five in parallel, after T001/T002 (Setup) complete.
- No task within Phase 3 or Phase 4 is parallelizable with another task in the same phase (both are single-file sequential builds, per contracts/refresh-api.md's per-file step ordering).
- T022 (bilingual copy review) and T023 (documentation) can run in parallel with each other and with T024/T025 (verification) once both user stories are complete.

---

## Parallel Example: Phase 2 (Foundational)

```bash
# Launch all five foundational tasks together — different files, no shared dependency
# (after T001's rebase and T002's directory creation have completed):
Task: "Create src/refresh/types.ts"
Task: "Create src/refresh/concurrencyGuard.ts"
Task: "Create src/refresh/summaryTrigger.ts"
Task: "Create src/refresh/embeddingRecompute.ts"
Task: "Add fetchArxivEntryById to src/collection/arxivClient.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T002) — the `develop` merge (T001) is done; only T002 remains.
2. Complete Phase 2: Foundational (T003–T007) — critical, blocks everything else.
3. Complete Phase 3: User Story 1 (T008–T014).
4. **STOP and VALIDATE**: Run quickstart.md Scenarios 1–4 independently.
5. This alone is a shippable MVP — a user can already refresh single papers on demand, including having their embedding correctly kept in sync with revised content.

### Incremental Delivery

1. Setup + Foundational → foundation ready (T001–T007).
2. Add User Story 1 → validate via quickstart Scenarios 1–4 → MVP ready (T008–T014).
3. Add User Story 2 → validate via quickstart Scenarios 5–7 (T015–T021) — this story is not independent of US1's `refreshOne`, so it cannot ship before US1.
4. Polish (T022–T025) → feature-complete.

---

## Notes

- No [P] marker appears inside Phase 3 or Phase 4 — both stories are single-file, strictly-ordered builds per the contract's own step numbering, not independent parallelizable units.
- Unlike the template's usual assumption, User Story 2 here is **not** independently implementable before User Story 1 — the spec's own Key Entities section establishes bulk refresh as reusing single-paper refresh's logic, not a parallel implementation of it.
- T001's branch merge was unusual for a tasks.md but load-bearing here: this feature was planned against `develop`'s current state (which includes a sibling feature's already-merged embedding work), while the feature branch itself predated that merge — T001 closed that gap (completed 2026-07-10) so T006/T011 can compile.
- Every implementation task cites its governing `contracts/refresh-api.md` section and/or `research.md` decision so implementation can proceed without re-deriving design choices already made in Phase 0/1.
- Commit after each task or logical group (T008–T014 as one group, T015–T021 as another, matching the two Checkpoints above).
