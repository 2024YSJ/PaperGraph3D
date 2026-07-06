---

description: "Task list for Subscription-Based Paper Collection"
---

# Tasks: Subscription-Based Paper Collection

**Input**: Design documents from `/specs/002-subscription-paper-collection/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/collection-pipeline.md

**Tests**: Not explicitly requested in `spec.md`. `plan.md`/`research.md` follow 001's precedent of no test framework in this repo. Correctness relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough (stubbed provider responses, no live network) — see the Polish phase.

**Organization**: Tasks are grouped by user story (Subscription management = P1/US1, Scheduled collection = P1/US2, Catch-up collection = P1/US3, Provider parsing & enrichment = P2/US4, per `spec.md`) so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every description includes the exact file path

## Path Conventions

Single project (this repo is one Obsidian plugin bundle, no frontend/backend split). All new files live under `src/collection/`, per `plan.md`'s Project Structure. `src/main.ts` is touched by exactly one task (Polish phase, scheduler wiring); no other existing file is modified.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [ ] T001 Create the `src/collection/` directory and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline (with 001's `src/models/` already present), so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to start adding collection modules.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by more than one user story — everything scheduled/catch-up collection (US2/US3) needs to read and update subscriptions, which is also this feature's own US1 concern, so the storage layer goes first.

- [ ] T002 [P] Implement `subscriptionStore.ts`'s `createSubscriptionStore(deps)` with `list()`, `register()`, `remove()`, `setEnabled()`, `setCheckInterval()` (delegating to 001's `assignCheckInterval`, per 001's own FR-005 rejection rule — reused here, not one of this spec's FRs), and `recordChecked()` in `src/collection/subscriptionStore.ts` (per `contracts/collection-pipeline.md` § subscriptionStore.ts and `data-model.md` § Subscription store) (FR-001, FR-002, FR-006, FR-010)
- [ ] T003 [P] Define the shared in-memory intermediate types (`CollectionWindow`, `ArxivEntry`, `SemanticScholarPaper`, `SemanticScholarReference`, `EnrichmentOutcome`, `CollectionRunState`, `PipelineHooks`) in a small shared types module `src/collection/types.ts` (per `data-model.md`) so parser/enrichment/pipeline files import one consistent set of shapes

**Checkpoint**: Subscription storage and shared types exist — US1 can be validated standalone; US2/US3/US4 have what they need to build on.

---

## Phase 3: User Story 1 - Register and manage subscriptions (Priority: P1) 🎯 MVP

**Goal**: Let any caller (eventually 008's settings UI) register, list, enable/disable, delete, and re-interval a subscription, with every change durably persisted.

**Independent Test**: Using a stubbed `load`/`save` pair (no real Obsidian `Plugin` instance needed), register a subscription of each type, view the list, disable one, delete another, change another's check interval, and confirm each action is reflected in what `save` receives — per `quickstart.md` § Subscription management.

### Implementation for User Story 1

- [ ] T004 [US1] Wire `register()` to apply `DEFAULT_CHECK_INTERVAL_HOURS` (001) when no interval is supplied and to persist via `deps.save` before resolving, in `src/collection/subscriptionStore.ts` (FR-001; depends on T002)
- [ ] T005 [US1] Confirm `remove()`/`setEnabled()`/`setCheckInterval()` each persist via `deps.save` before resolving and that `setCheckInterval` on a disallowed value leaves the stored interval unchanged (per 001's FR-005 rejection rule, applied at the store layer — see FR-002 for this feature's own "user MUST be able to change an existing subscription's check interval" requirement), in `src/collection/subscriptionStore.ts` (FR-002, FR-010; depends on T002, T004)

**Checkpoint**: User Story 1 is fully functional and independently testable — `subscriptionStore.ts` satisfies SC-005 (disabling stops later collection, verified fully once US2/US3 consume it) at the storage layer.

---

## Phase 4: User Story 4 - Provider parsing and citation enrichment (Priority: P2)

**Goal**: Turn a raw arXiv Atom XML response and a raw Semantic Scholar JSON response into the shared `PaperCandidate`/`Paper` shape (001), with `citationsKnown` correctly distinguishing "unconfirmed" from "confirmed zero."

**Independent Test**: Feed a stubbed arXiv Atom XML string and a stubbed Semantic Scholar JSON object through parsing and confirm both produce the correct `PaperCandidate`/enrichment output, per `quickstart.md` § Provider parsing.

**Note**: Implemented ahead of US2/US3 (despite lower priority) because the scheduler (US2/US3) has nothing to schedule without a way to query and parse a provider response — this is a dependency ordering choice, not a change to the spec's priority for user-facing value.

### Implementation for User Story 4

- [ ] T006 [P] [US4] Implement `queryArxiv(subscription, window)` using `requestUrl` against the arXiv API — building the type-specific `search_query` clause combined with `submittedDate:[from TO to]`, paging via `start`/`max_results=100` up to a 10-page (1,000-entry) safety cap with a 3-second delay between page requests, returning raw Atom `<entry>` DOM nodes plus a `truncated` flag when the cap is hit — in `src/collection/arxivClient.ts` (per `contracts/collection-pipeline.md` § arxivClient.ts and `research.md` Decision 12) (FR-008, FR-014)
- [ ] T007 [P] [US4] Implement `fetchSemanticScholarPaper(identity)` using `requestUrl` against `GET /graph/v1/paper/ARXIV:<id>` (arXiv-ID form) or `GET /graph/v1/paper/search` (title+author fallback), returning a typed `{status: 200, body} | {status: 404} | {status: 429} | {status: 'networkError'}` outcome — never throwing — in `src/collection/semanticScholarClient.ts` (per `contracts/collection-pipeline.md` § arxivClient.ts/semanticScholarClient.ts and `research.md` Decision 13) (FR-008)
- [ ] T008 [P] [US4] Implement `parseArxivAtom(xml): PaperCandidate[]` using `DOMParser` to map each `<entry>` to a `PaperCandidate` with `citationCount`/`references` left `undefined` and `sourceId` built as `` `arxiv:${arxivId}` ``, in `src/collection/arxivParser.ts` (per `data-model.md` § Provider response intermediate shapes) (FR-007, FR-015)
- [ ] T009 [P] [US4] Implement the Semantic Scholar JSON → citation-field mapper, normalizing each reference's `sourceId` to `` `arxiv:${id}` `` when an arXiv ID is present and to `` `semanticScholar:${id}` `` otherwise, in `src/collection/semanticScholarParser.ts` (FR-019; Clarification 2026-07-05 § sourceId scheme)
- [ ] T010 [US4] Implement `enrichFromSemanticScholar(candidate): Promise<EnrichmentOutcome>` — arXiv-ID match first, title+first-author fallback, mapping a `404` from T007 to `'terminalAbsence'` and a `429`/`'networkError'` to up to 3 bounded transient retries (3-second spacing) before returning `'transientFailure'` — in `src/collection/enrichment.ts` (per `contracts/collection-pipeline.md` § enrichment.ts and `research.md` Decision 13) (FR-016, FR-018; depends on T007, T009)
- [ ] T011 [US4] Implement `promote(candidate): Paper | undefined` as a thin call-through to 001's `toPaper`, in `src/collection/promotion.ts` (per `contracts/collection-pipeline.md` § promotion.ts) (FR-011, FR-016, FR-018; depends on T008)

**Checkpoint**: User Story 4 is fully functional and independently testable — parsing/enrichment/promotion satisfy SC-007 without needing the scheduler.

---

## Phase 5: User Story 2 - Automatic scheduled collection while running (Priority: P1)

**Goal**: Each enabled subscription automatically checks for new papers on its own interval while the plugin runs, deduplicated and processed sequentially, with `lastCheckedAt` advanced only over what was actually searched, and provider failures surfaced to the user rather than silently swallowed.

**Independent Test**: With a subscription whose interval has elapsed, advance time and confirm a check fires, produces canonical `Paper` data (via T006–T011's stubbed pipeline), and updates the subscription's `lastCheckedAt` — per `quickstart.md`'s dedup and window scenarios. Separately, stub `queryArxiv` to reject and confirm the failure is surfaced to the user and `lastCheckedAt` is left untouched.

### Implementation for User Story 2

- [ ] T012 [P] [US2] Implement the per-run `CollectionRunState` (seen-set + `alreadyPersisted` hook) in `src/collection/dedupe.ts` (per `data-model.md` § Dedup and batch state) (FR-009)
- [ ] T013 [P] [US2] Implement the sequential, yielding batch loop `runCollectionPass(candidates, hooks, summarizationEnabled)` — skip-if-seen/already-persisted, skip-if-not-promotable, enrich → optional summarize → persist, one candidate at a time, continuing past any single candidate's enrichment/summarization failure — in `src/collection/pipeline.ts` (per `contracts/collection-pipeline.md` § pipeline.ts) (FR-009, FR-011, FR-012, FR-013, FR-017; depends on T010, T011, T012)
- [ ] T014 [US2] Implement `computeCollectionWindow(subscription, now)` (`lastCheckedAt` → `now`, or `now - 24h` → `now` when `lastCheckedAt` is null) in `src/collection/scheduler.ts` (per Clarification 2026-07-05 § first-collection window) (FR-004)
- [ ] T015 [US2] Implement `startScheduler(plugin, deps)`: a single `plugin.registerInterval(...)`-backed tick that, on each firing, calls `runCheck` for every subscription that is `enabled` and due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`), then calls `subscriptionStore.recordChecked` only on success and never past the searched window, in `src/collection/scheduler.ts` (per `contracts/collection-pipeline.md` § scheduler.ts) (FR-003, FR-005, FR-006, FR-010; depends on T002, T013, T014)
- [ ] T016 [US2] When a subscription's `runCheck` (T015) rejects — e.g. `queryArxiv`/`fetchSemanticScholarPaper` unreachable or erroring — catch it, leave `lastCheckedAt` untouched (relies on T015), and surface a bilingual-ready user-facing failure notice distinct from T017's truncated-window notice, so the failure is retried on the next scheduled interval/load rather than silently dropped, in `src/collection/scheduler.ts` (FR-012; depends on T015)

**Checkpoint**: User Stories 1, 4, and 2 all work independently and together — SC-001, SC-004, SC-005, SC-006 are satisfiable end-to-end with a stubbed provider client.

---

## Phase 6: User Story 3 - Catch-up collection across the off period (Priority: P1)

**Goal**: On plugin load, run exactly one catch-up search per enabled subscription over the window since it was last checked, so no off-period time is permanently lost.

**Independent Test**: Set a subscription's `lastCheckedAt` to the past, invoke the scheduler's load-time entry point, and confirm exactly one catch-up search runs per enabled subscription over the correct window, then `lastCheckedAt` advances to now — per `quickstart.md`'s window scenarios and spec.md's User Story 3 acceptance scenarios.

### Implementation for User Story 3

- [ ] T017 [US3] Extend `startScheduler` to run one catch-up pass over every enabled subscription (using `computeCollectionWindow`, T014) before the first recurring tick fires, in `src/collection/scheduler.ts` (FR-004; depends on T014, T015)
- [ ] T018 [US3] Ensure the catch-up pass surfaces a user-facing (bilingual-copy-ready, per constitution Principle V) notice when `queryArxiv`'s `truncated` flag is `true` for any subscription in the pass, in `src/collection/scheduler.ts` (FR-014; depends on T006, T017)

**Checkpoint**: All four user stories are independently functional — SC-002, SC-003, SC-008 are satisfiable end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide gates, plugin lifecycle wiring, and the manual validation pass, across the whole feature.

- [ ] T019 Wire `startScheduler(this, { ... })` into `onload` in `src/main.ts`, sourcing `deps.load`/`deps.save` from `this.loadData()`/`this.saveData()` and `deps.persist`/`deps.summarize` from no-op stubs until 003/004 exist (constitution Principle II: only via `registerInterval`, no explicit `onunload` stop code needed — this is also what satisfies FR-005/SC-003's "no collection while off," since nothing runs once `registerInterval` is cleaned up on unload) (FR-005; depends on T015, T017)
- [ ] T020 [P] Add README.md and settings-copy-ready disclosure text describing what this feature calls (arXiv, Semantic Scholar), why, and that it only runs once a subscription is registered (constitution Principle IV; bilingual-ready copy per Principle V)
- [ ] T021 [P] Run `npm run build` (`tsc --noEmit` + esbuild) and confirm it passes with all new `src/collection/*.ts` files and the `src/main.ts` change present (constitution Development Workflow gate)
- [ ] T022 [P] Run `npm run lint` and confirm it introduces no new errors/warnings beyond 001's pre-existing baseline (constitution Development Workflow gate)
- [ ] T023 Execute `quickstart.md` end-to-end: create `scratch/verify-collection.ts`, run it via the documented `esbuild`+`node` steps, confirm every scenario prints `PASS` — including a scenario that stops the scheduler and asserts no further `runCheck` fires afterward (SC-003) — then `rm -rf scratch/` (depends on T004, T005, T008, T011, T013, T014, T019)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 only. Blocks all user story phases (T002 blocks US1/US2/US3; T003's shared types are used by US4/US2).
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T002). Independently testable in isolation.
- **User Story 4 (Phase 4)**: Depends on Phase 2 (T003) only — does not depend on US1. Independently testable in isolation.
- **User Story 2 (Phase 5)**: Depends on Phase 2 (T002) and Phase 4 (T010, T011) for a working pipeline to schedule.
- **User Story 3 (Phase 6)**: Depends on Phase 5 (T014, T015) — catch-up reuses the scheduler's window/tick machinery.
- **Polish (Phase 7)**: T019 depends on US2+US3 (T015, T017); T021–T023 depend on all prior phases being present.

### Within Each User Story

- US1: T004 → T005 (same file, sequential)
- US4: {T006, T007, T008, T009} in parallel → T010 (depends on T007, T009) → T011 (depends on T008)
- US2: {T012, T013} in parallel (T013 also depends on US4's T010/T011) → T014 → T015 (depends on T002, T013, T014) → T016 (depends on T015)
- US3: T017 (depends on T014, T015) → T018 (depends on T006, T017)

### Parallel Opportunities

- T002 and T003 can start together immediately after T001.
- T006, T007, T008, T009 (US4) can all start together once T003 is done — four different files, no cross-task dependency until T010/T011.
- T012 (US2) can start as soon as T003 is done, in parallel with all of US4's tasks.
- T020, T021, T022 (Polish) can run together once the rest of the feature is implemented.

---

## Parallel Example: Kicking off Foundational and User Story 4 together

```bash
# After T001 (Setup) completes:
Task: "Implement createSubscriptionStore in src/collection/subscriptionStore.ts"
Task: "Define shared collection types in src/collection/types.ts"
# Once types.ts (T003) is done, all of these can start together:
Task: "Implement queryArxiv in src/collection/arxivClient.ts"
Task: "Implement fetchSemanticScholarPaper in src/collection/semanticScholarClient.ts"
Task: "Implement parseArxivAtom in src/collection/arxivParser.ts"
Task: "Implement the Semantic Scholar citation-field mapper in src/collection/semanticScholarParser.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002, T003)
3. Complete Phase 3: User Story 1 (T004–T005)
4. **STOP and VALIDATE**: run `npm run build` and manually exercise `subscriptionStore.ts` per `quickstart.md`'s Subscription management scenarios
5. `subscriptionStore.ts` alone already gives 008's future settings UI something to call, and is usable standalone even before any provider integration exists

### Incremental Delivery

1. Setup → Foundational (subscription storage + shared types) ready
2. Add User Story 1 (subscription management) → validate independently → MVP
3. Add User Story 4 (provider parsing & enrichment) → validate independently (no scheduler needed)
4. Add User Story 2 (scheduled collection, including failure notification) → validate independently (ties US1 storage + US4 pipeline together via the scheduler)
5. Add User Story 3 (catch-up collection) → validate independently (extends US2's scheduler)
6. Polish: plugin wiring, disclosure copy, full build/lint/quickstart pass

### Parallel Team Strategy

With multiple developers: after T001–T003, one person takes US1 (`subscriptionStore.ts` CRUD), one takes US4 (the four parser/client/enrichment/promotion files), and once both land, a third takes US2+US3 (`dedupe.ts`, `pipeline.ts`, `scheduler.ts`), which is the only phase that depends on both of the others.

---

## Notes

- [P] tasks touch different files with no dependency on an incomplete task.
- [Story] labels map every implementation task back to its `spec.md` user story for traceability.
- No test tasks are included — see the "Tests" note at the top of this file.
- Every task traces to a specific FR-/SC- number from `spec.md`; the 5 Clarifications (2026-07-05) are cited directly where they drove a specific implementation choice (T006/T009/T010/T014).
- Where a task relies on 001's own rules (e.g. `assignCheckInterval`'s rejection behavior in T002/T005), the citation points to 001, not to one of this spec's 18 FRs — 002 has no FR of its own for that specific rejection rule, only for exposing the ability to change an interval at all (FR-002).
- T019's `deps.persist`/`deps.summarize` stubs are a deliberate seam (research.md Decision 10) — swapping them for real 003/004 calls is a future feature's task, not this one's, per spec.md's Out of Scope.
- Commit after each task or logical group (per this repo's usual workflow).
- Stop at any checkpoint to validate a story independently before moving on.
