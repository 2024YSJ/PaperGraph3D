---

description: "Task list for Paper Note Persistence (JSON + Markdown)"
---

# Tasks: Paper Note Persistence (JSON + Markdown)

**Input**: Design documents from `/specs/003-paper-note-persistence/`

**Prerequisites**: plan.md (required), spec.md (user stories), research.md, data-model.md, contracts/persistence-api.md

**Tests**: Not requested in `spec.md`, and this repo has no test runner (`CLAUDE.md`); `plan.md`/`research.md` decide against adding one (matching 001). Correctness relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough against the `InMemoryFileStore` fake — see the Polish phase. No test tasks are generated.

**Organization**: Tasks are grouped by the three P1 user stories from `spec.md` (US1 create, US2 update-merge, US3 folder-boundary+delete). The pure building blocks all three share are in Foundational (Phase 2).

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (user-story phases only)
- Every description includes an exact file path

## Path Conventions

Single project (one Obsidian plugin bundle). All new code lives under `src/persistence/`, per `plan.md`. The 001 `Paper` shape in `src/models/paper.ts` is reused unchanged. `src/main.ts`/`src/settings.ts` are NOT modified here — wiring the store into the plugin lifecycle (calling `load()` at `onload`, supplying the settings folder) is owned by 008 (spec Out of Scope).

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [X] T001 Create the `src/persistence/` directory and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline, so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to add the persistence modules.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure, side-effect-isolated building blocks every user story's store operation depends on. Per `research.md`, all Obsidian I/O is confined to the `ObsidianFileStore` adapter; everything else is Obsidian-free and offline-testable.

**⚠️ CRITICAL**: No user-story work can begin until this phase is complete.

- [X] T002 [P] Define the `FileStore` port (`read`/`write`/`delete`/`exists`/`list`) and the `InMemoryFileStore` verification fake in `src/persistence/filestore.ts` (per contracts/persistence-api.md; all paths resolved inside the base folder — FR-006)
- [X] T003 [P] Implement `fileStem(sourceId, taken)` injective sanitization (provider prefix + sanitized local part, deterministic disambiguator on clash) in `src/persistence/filename.ts` (FR-007)
- [X] T004 [P] Define `PaperRecord` (wrapped superset) + `ReadState`, and implement `wrap()`/`unwrap()`/`migrate()` with the field-scoped merge — preserving `summary`/`futureDirections`/`readState`/`createdAt` and the embedding preserve-unless-supplied rule, plus pending-embedding normalization + `schemaVersion` bump — in `src/persistence/record.ts` (FR-004/FR-016/FR-020/FR-022, SC-007; Clarifications 2026-07-08)
- [X] T005 [P] Implement `renderNote()`/`parseNote()` — three regions (YAML frontmatter mirrored subset via a minimal Obsidian-free serializer for the fixed schema, `<!-- pg3d:begin/end -->` managed body block, preserved user body); the embedding is never written to any region — in `src/persistence/note.ts` (FR-002/FR-005/FR-022, SC-008; OQ-4: authors as block sequence, references excluded)
- [X] T006 [P] Implement the in-memory Record Index (`IndexEntry` lightweight metadata only — no embedding vectors/references/prose; `build`, `has`, `upsertEntry`, `removeEntry`, `entryFromRecord`) in `src/persistence/index.ts` (FR-015, SC-006; Clarification 2026-07-08)
- [X] T007 Implement the production `ObsidianFileStore` adapter over the Obsidian `Vault` API (folder-scoped read/write/delete/exists/list; `null` on absent) in `src/persistence/filestore-obsidian.ts` (depends on T002; kept in its own file so it is the only Obsidian-touching code and the core stays offline-testable)

**Checkpoint**: Building blocks compile and are unit-exercisable via the fake — user-story store paths can now be assembled.

---

## Phase 3: User Story 1 - A note (and record) is created for every new paper (Priority: P1) 🎯 MVP

**Goal**: Persisting a new paper writes a coordinated `.json` record + `.md` note pair in the storage folder, keyed by `sourceId`, with the note's managed region mirroring the record and the embedding kept out of the note.

**Independent Test**: Feed a canonical `Paper` to `upsert()` (over the `InMemoryFileStore`) and confirm exactly one `.json` and one `.md` appear sharing the stem, the frontmatter mirrors the FR-002 subset, the embedding is absent from the note, and an injected note-write failure leaves neither file.

### Implementation for User Story 1

- [X] T008 [US1] Create the `PaperStore` class skeleton — constructor(`FileStore`, base folder), the `PersistInput` input type, and per-`sourceId` write serialization (async lock/promise-chain map, FR-014) — in `src/persistence/store.ts` (depends on T002–T006)
- [X] T009 [US1] Implement `upsert()` create path in `src/persistence/store.ts`: coordinated create writing the `.json` durably before the `.md`, updating the index, mirroring only the FR-002 subset into the note and never the embedding; roll back to "neither file" on a detected write failure (FR-001/FR-002/FR-003/FR-011/FR-021 create-ordering, SC-001/SC-008; depends on T008)
- [X] T010 [US1] Implement `has(sourceId)` (index-served existence check) and `get(sourceId)` (single read-back reading the `.json` on demand into a canonical `Paper`, embedding vector included) in `src/persistence/store.ts` (FR-015a/b; depends on T008, T009)

**Checkpoint**: New papers persist as consistent pairs and are read-back-able — 002 dedup (`has`) and 005 single read (`get`) are usable. MVP reached.

---

## Phase 4: User Story 2 - Updates merge without destroying user writing (Priority: P1)

**Goal**: Re-persisting an existing paper merges in place (field-scoped) — updating the managed region and record while leaving the user's hand-written body byte-for-byte intact and preserving cross-feature fields and a stored embedding.

**Independent Test**: Persist a paper, append hand-written text to the note body, then `upsert()` an updated `Paper` (including one whose `embedding` is `null`); confirm the managed region/record update, the user body is unchanged, and `summary`/embedding survive — with no duplicate note.

### Implementation for User Story 2

- [X] T011 [US2] Implement `upsert()` update path in `src/persistence/store.ts`: detect the existing pairing via `has()`, read the previous record + note, field-scoped-merge via `record.wrap(prev)`, rebuild only the managed region while re-appending the parsed user body verbatim, and never create a duplicate — so cross-feature wrapper fields and a stored non-null embedding are preserved and the user body is untouched (FR-004/FR-005/FR-008/FR-010, SC-002/SC-003/SC-007; depends on T009, T010)

**Checkpoint**: Updates from collection (002) and refresh (005) are safe — user content and enriched fields never clobbered.

---

## Phase 5: User Story 3 - The plugin stays inside its designated folder (Priority: P1)

**Goal**: Every create/update/delete acts only inside the designated folder; deletes remove both files (tombstoned, recoverable); load builds the index and reconciles inconsistencies JSON-authoritatively, ignoring non-paper files.

**Independent Test**: Point the store at a folder and run create/update/delete — confirm no path outside the folder is ever touched, delete removes both files, an interrupted delete completes on next `load`, an orphan record rebuilds its note, an orphan note (no tombstone) is reported, and the projection-basis cache is ignored.

### Implementation for User Story 3

- [X] T012 [P] [US3] Implement tombstone + reconciliation in `src/persistence/reconcile.ts`: write/detect/complete the per-paper `<stem>.pg3d-del` tombstone; reconcile a record-without-note (rebuild note from record), a note-without-record-and-no-tombstone (report, never delete), and resume a tombstoned delete; explicitly ignore non-paper files (projection-basis cache, tombstones) (FR-013/FR-021/FR-023; can develop alongside store tasks — different file)
- [X] T013 [US3] Implement `delete()` in `src/persistence/store.ts`: tombstoned two-phase (tombstone → remove `.md` → remove `.json` → remove tombstone), remove the index entry, confined to the folder (FR-012/FR-021; depends on T008, T012)
- [X] T014 [US3] Implement `load()` and `all()` in `src/persistence/store.ts`: scan the folder and **pair each `.json`↔`.md` by content-level `sourceId`/`pg3d_sourceId` (rename-safe, never by filename — FR-009)**, build the metadata-only index (no embedding vectors) within the SC-006 budget, resume tombstoned deletes and reconcile via T012, and async-enumerate all records back into `Paper` (hydrating embeddings on demand) for 006 (FR-009/FR-013/FR-015c/FR-017, SC-005/SC-006; depends on T006, T010, T012)
- [X] T015 [US3] Enforce the folder boundary and folder lifecycle in `src/persistence/store.ts`/`filestore.ts`: never act outside the base folder, inform the user and avoid half-written pairings when the folder is missing/inaccessible, and on a storage-folder change leave old pairings in place and rebuild the index from the new folder (FR-006/FR-011/FR-018, SC-004; depends on T008)

**Checkpoint**: All three P1 stories are independently functional; the pairing invariant, boundary invariant, and delete recovery all hold.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide gates and the manual verification pass across the whole feature.

- [X] T016 [P] Run `npm run build` (`tsc --noEmit` + esbuild) and confirm it passes with all `src/persistence/*.ts` present (constitution Development Workflow gate)
- [X] T017 [P] Run `npm run lint` and confirm `src/persistence/*.ts` introduces zero new lint errors versus the baseline (T001)
- [X] T018 Execute `quickstart.md` end-to-end: create `scratch/verify-persistence.ts` driving `PaperStore` over `InMemoryFileStore`, run it via the documented `esbuild`+`node` steps, confirm every scenario prints `PASS` — **including an SC-006 load-timing smoke (build the index over ~1,000 synthetic records and assert it completes within the ≤2 s budget)** — then `rm -rf scratch/` (depends on T009, T011, T013, T014)
- [ ] T019 Manual in-vault smoke of the `ObsidianFileStore` adapter (T007): in a scratch vault, create/update/delete a paper and confirm the `.json`/`.md` pair appears, a hand-typed body survives an update, and nothing outside the folder changes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS all user stories. T002–T006 are parallel; T007 follows T002 (same file).
- **User Stories (Phase 3–5)**: All depend on Foundational. They share `src/persistence/store.ts`, so their store tasks are sequential (US1 create → US2 update → US3 delete/load), not parallel; US3's `reconcile.ts` (T012) is the one story task that can proceed in parallel with earlier store work.
- **Polish (Phase 6)**: T016/T017 after the code exists; T018 after all store paths (T009/T011/T013/T014); T019 after T007.

### Within/Across User Stories

- US1: T008 → T009 → T010 (same file, sequential).
- US2: T011 depends on T009 + T010.
- US3: T012 [P] (different file); T013 depends on T008 + T012; T014 depends on T006 + T010 + T012; T015 depends on T008.

### Parallel Opportunities

- Foundational T003, T004, T005, T006 run in parallel (different files); T002 in parallel with them, T007 after T002.
- T012 (`reconcile.ts`) can be built in parallel with the US1/US2 store tasks (different file).
- T016 and T017 run together.

---

## Parallel Example: Foundational building blocks

```bash
# After T001, launch the independent building blocks together (different files):
Task: "FileStore port + InMemoryFileStore fake in src/persistence/filestore.ts"
Task: "fileStem injective sanitization in src/persistence/filename.ts"
Task: "PaperRecord + wrap/unwrap/migrate + field-scoped merge in src/persistence/record.ts"
Task: "renderNote/parseNote three-region serializer in src/persistence/note.ts"
Task: "Record Index (lightweight) in src/persistence/index.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — all building blocks).
2. Complete Phase 3 (US1): create pairing + `has()`/`get()`.
3. **STOP and VALIDATE**: run the US1 quickstart scenarios over the fake. At this point 002 can dedup and persist new papers and 005 can read one back — a usable increment.

### Incremental Delivery

1. Setup + Foundational → building blocks ready.
2. US1 (create + read) → validate → MVP (unblocks 002 persist/dedup, 005 read).
3. US2 (update-merge) → validate → safe re-collection/refresh.
4. US3 (boundary + delete + load/reconcile) → validate → full lifecycle + 006 enumeration.
5. Polish: build/lint/quickstart + adapter smoke.

### Parallel Team Strategy

After Foundational, one developer can carry the `store.ts` write-path chain (US1 → US2 → US3 store tasks, sequential on one file) while another builds `reconcile.ts` (T012) in parallel; the `ObsidianFileStore` adapter (T007) and its smoke (T019) can be owned independently.

---

## Notes

- [P] = different files, no dependency on an incomplete task. `src/persistence/store.ts` is touched by US1/US2/US3, so those tasks are deliberately sequential (not [P]).
- No test tasks — see the Tests note at the top; verification is `tsc`/`eslint` + the `quickstart.md` walkthrough (T018) over the `InMemoryFileStore` fake, plus the adapter smoke (T019).
- Every task traces to FR-/SC- numbers from `spec.md` and the interfaces in `contracts/persistence-api.md`; consult `data-model.md` and `research.md` for exact shapes/decisions before implementing.
- Wiring the store into the plugin (`onload` load, settings folder, read/unread toggle) is 008's job, not here (spec Out of Scope).
- User-facing `Notice`s (orphan report in T012, folder inaccessible/moved in T015) MUST follow the bilingual/plain-English policy (constitution Principle V).
- FR-017 (no live watcher) and FR-019 (delegate sync-conflicts, no own merge) are non-action constraints satisfied by the reconciliation design (T012/T014) + per-paper sidecars — no dedicated task.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.

---

## Phase 7: Convergence

**Purpose**: Remaining work found by `/speckit-converge` assessing the current `src/persistence/` code against the spec/plan/tasks. Append-only; complete via `/speckit-implement`.

- [X] T020 Add a storage-folder-change entry point in the persistence layer (a `PaperStore` re-init / `onStorageFolderChanged` method or helper that 008 calls) that leaves existing pairings untouched at the old folder, rebuilds the in-memory index from the new folder, and informs the user that previously stored papers remain in the old location, in `src/persistence/store.ts` per FR-018 (partial)
- [X] T021 Emit a user-facing notice when the record (`.json`) write fails on create (e.g. the storage folder is inaccessible), not only on the note-write failure, in `src/persistence/store.ts` per FR-011 (partial)
