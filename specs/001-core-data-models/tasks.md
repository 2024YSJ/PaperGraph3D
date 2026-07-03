---

description: "Task list for Core Data Structures"
---

# Tasks: Core Data Structures

**Input**: Design documents from `/specs/001-core-data-models/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/data-model-api.md

**Tests**: Not requested in `spec.md`, and `plan.md`/`research.md` explicitly decided against adding a test framework (none exists in this repo). Correctness instead relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough — see the Polish phase.

**Organization**: Tasks are grouped by user story (Subscription = P1/US1, Paper = P2/US2, Plugin Settings = P3/US3, per `spec.md`) so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Every description includes the exact file path

## Path Conventions

Single project (this repo is one Obsidian plugin bundle, no frontend/backend split). All new files live under `src/models/`, per `plan.md`'s Project Structure. No existing file (`src/main.ts`, `src/settings.ts`) is modified by any task below.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [ ] T001 Create the `src/models/` directory and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline, so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to start adding entity modules.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by all user stories.

**None required.** `data-model.md`'s "Cross-entity notes" confirm Subscription, Paper, and Plugin Settings share no types and reference each other by nothing — each lives entirely in its own file with no shared base module to build first. Proceed directly from Phase 1 to the user story phases below.

---

## Phase 3: User Story 1 - Reference the subscription data shape (Priority: P1) 🎯 MVP

**Goal**: Give any feature that creates/reads subscriptions one fixed `Subscription` type, a restricted-to-five-values check interval, and validation/assignment functions to enforce it.

**Independent Test**: Construct sample `Subscription` objects (valid and invalid) and confirm `isValidSubscription()` accepts every valid combination of type/value/label/interval/last-checked/enabled and rejects any record missing a field or using a disallowed interval; confirm `assignCheckInterval()` rejects out-of-range values and keeps the prior one. No other entity or file is needed to run this test.

### Implementation for User Story 1

- [ ] T002 [P] [US1] Define `SubscriptionType`, `CheckIntervalHours`, `ALLOWED_CHECK_INTERVALS_HOURS`, `DEFAULT_CHECK_INTERVAL_HOURS`, and the `Subscription` interface (per `contracts/data-model-api.md` § subscription.ts and `data-model.md` § Subscription) in `src/models/subscription.ts`
- [ ] T003 [US1] Implement `isValidSubscription(data: unknown): data is Subscription` and `assignCheckInterval(current, requested): CheckIntervalHours` in `src/models/subscription.ts` (FR-001–FR-007; depends on T002)

**Checkpoint**: User Story 1 is fully functional and independently testable — `src/models/subscription.ts` type-checks on its own and satisfies SC-002.

---

## Phase 4: User Story 2 - Reference the paper data shape (Priority: P2)

**Goal**: Give any feature that collects/shows papers one fixed `Paper` type, a provider-tagged unique `sourceId`, and the "hold back" rule for papers missing a publication year.

**Independent Test**: Construct sample `PaperCandidate`/`Paper` records (valid, missing-year, and missing-other-field) and confirm `toPaper()` returns a `Paper` only when `publicationYear` is present (returns `undefined` — held back, not discarded — otherwise), `isValidPaper()` accepts only fully-populated records, and `isPaperSourceId()` accepts only provider-tagged strings. No other entity or file is needed to run this test.

### Implementation for User Story 2

- [ ] T004 [P] [US2] Define `SourceProvider`, `PaperSourceId`, `PaperCandidate`, and `Paper` (per `contracts/data-model-api.md` § paper.ts and `data-model.md` § Paper) in `src/models/paper.ts` (FR-008)
- [ ] T005 [US2] Implement `isPaperSourceId(value: string): value is PaperSourceId` in `src/models/paper.ts` (FR-015; depends on T004)
- [ ] T006 [US2] Implement `toPaper(candidate: PaperCandidate): Paper | undefined`, returning `undefined` exactly when `publicationYear` is missing, in `src/models/paper.ts` (FR-009, FR-010; depends on T004)
- [ ] T007 [US2] Implement `isValidPaper(data: unknown): data is Paper` — checking all six fields including `sourceId` via `isPaperSourceId()` — in `src/models/paper.ts` (FR-014, SC-003, SC-005; depends on T004, T005)

**Checkpoint**: User Stories 1 AND 2 both work independently — `src/models/paper.ts` type-checks on its own and satisfies SC-003/SC-005.

---

## Phase 5: User Story 3 - Reference the settings data shape (Priority: P3)

**Goal**: Give any feature that reads plugin-wide configuration one fixed `PluginSettings` type that always resolves to concrete, non-empty defaults.

**Independent Test**: Load `DEFAULT_PLUGIN_SETTINGS` with nothing else configured and confirm `isValidPluginSettings()` accepts it, `storageLocation` is a non-empty string, and `summarizationEnabled` is `false`. No other entity or file is needed to run this test.

### Implementation for User Story 3

- [ ] T008 [P] [US3] Define `GraphDisplayOptions` and `PluginSettings` (per `contracts/data-model-api.md` § settings.ts and `data-model.md` § Plugin Settings) in `src/models/settings.ts` — a new file, distinct from the existing stock `src/settings.ts` (FR-013)
- [ ] T009 [US3] Implement `DEFAULT_PLUGIN_SETTINGS` with a concrete non-empty `storageLocation` (e.g. `'PaperGraph3D'`), `summarizationEnabled: false`, and placeholder `graphDisplayOptions` in `src/models/settings.ts` (FR-011, FR-012; depends on T008)
- [ ] T010 [US3] Implement `isValidPluginSettings(data: unknown): data is PluginSettings` in `src/models/settings.ts` (FR-014, SC-004; depends on T008)

**Checkpoint**: All three user stories are independently functional — `src/models/settings.ts` type-checks on its own and satisfies SC-004.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide gates and the manual validation pass, across all three entities.

- [ ] T011 [P] Run `npm run build` (`tsc --noEmit` + esbuild) and confirm it passes with all three new `src/models/*.ts` files present (constitution Development Workflow gate)
- [ ] T012 [P] Run `npm run lint` and confirm it passes with all three new files present (constitution Development Workflow gate)
- [ ] T013 Execute `quickstart.md` end-to-end: create `scratch/verify-models.ts`, run it via the documented `esbuild`+`node` steps, confirm every scenario prints `PASS`, then `rm -rf scratch/` (depends on T003, T007, T010)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Empty — nothing blocks the user stories.
- **User Stories (Phase 3–5)**: Each depends only on Phase 1 (T001). They touch entirely separate files, so US1/US2/US3 can proceed in parallel or in any order — priority order (P1 → P2 → P3) is a sequencing suggestion, not a hard dependency.
- **Polish (Phase 6)**: T011/T012 depend on Phase 1 only (can run as soon as any file exists, but are most meaningful once all three stories are done); T013 depends on all three stories being complete (T003, T007, T010).

### Within Each User Story

- US1: T002 → T003 (same file, sequential)
- US2: T004 → T005, T004 → T006, {T004, T005} → T007 (same file, sequential)
- US3: T008 → T009, T008 → T010 (same file, sequential)

### Parallel Opportunities

- T002 (US1), T004 (US2), and T008 (US3) can all start together immediately after T001 — three different files, no cross-story dependency.
- T011 and T012 can run together (different commands, neither modifies files).

---

## Parallel Example: Kicking off all three stories together

```bash
# After T001 (Setup) completes, launch the first task of each story in parallel:
Task: "Define SubscriptionType, CheckIntervalHours, ALLOWED_CHECK_INTERVALS_HOURS, DEFAULT_CHECK_INTERVAL_HOURS, and Subscription in src/models/subscription.ts"
Task: "Define SourceProvider, PaperSourceId, PaperCandidate, and Paper in src/models/paper.ts"
Task: "Define GraphDisplayOptions and PluginSettings in src/models/settings.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 3: User Story 1 (T002–T003)
3. **STOP and VALIDATE**: run `npm run build` and manually exercise `isValidSubscription()`/`assignCheckInterval()` per `quickstart.md`'s Subscription scenarios
4. `src/models/subscription.ts` alone already satisfies spec.md's SC-002 and is usable by any feature that only needs subscriptions (e.g., early work on the subscription-collection feature) — Paper and Settings can follow later without touching it

### Incremental Delivery

1. Setup → Foundation ready (trivially, nothing to build)
2. Add User Story 1 (Subscription) → validate independently → MVP
3. Add User Story 2 (Paper) → validate independently
4. Add User Story 3 (Plugin Settings) → validate independently
5. Polish: full build/lint/quickstart pass across all three

### Parallel Team Strategy

With multiple developers: after T001, one person takes US1 (`subscription.ts`), one takes US2 (`paper.ts`), one takes US3 (`settings.ts`) — no file overlap, no cross-story dependency, so all three can finish and be reviewed independently before Polish.

---

## Notes

- [P] tasks touch different files with no dependency on an incomplete task.
- [Story] labels map every implementation task back to its `spec.md` user story for traceability.
- No test tasks are included — see the "Tests" note at the top of this file.
- Every field/rule/function traces to a specific FR-/SC- number from `spec.md`; consult `data-model.md` and `contracts/data-model-api.md` for the exact types and behavior guarantees before implementing.
- Commit after each task or logical group (per this repo's usual workflow).
- Stop at any checkpoint to validate a story independently before moving on.
