# spec-test report: 003-paper-note-persistence

- **Spec**: `specs/003-paper-note-persistence/spec.md`
- **Source branch**: `develop-feature/003-paper-note-persistence`
- **Date**: 2026-07-08
- **`tsc --noEmit`**: PASS (exit 0 — `src/` type-checks; `specs-test/` is outside `tsconfig` include)
- **Result**: **24 passed / 0 failed / 2 skipped**

Tests are derived from the spec's acceptance scenarios (`US<n>.<m>`), success criteria (`SC-xxx`), and concrete edge cases (`EC-<n>`), exercised against the real `src/persistence` exports (`PaperStore`, `parseNote`, `fileStem`, …) over the `InMemoryFileStore` fake.

## Cases

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1 | create → both `.json` + `.md`, keyed by sourceId | PASS | one pair, `arxiv_<n>.{json,md}` |
| US1.2 | note managed region mirrors record's shared fields (FR-002) | PASS | frontmatter carries the subset; excludes references/schemaVersion/embedding |
| US1.3 | partial persistence leaves neither record nor note | PASS | note-write failure rolls back the record |
| US2.1 | update merges in place; no duplicate | PASS | record updated, single note |
| US2.2 | user hand-written body untouched by update | PASS | body byte-for-byte preserved |
| US2.3 | re-collect identical → no duplicate, consistent | PASS | |
| US3.1 | create/update/delete touch only in-folder paths | PASS | no path escapes (relative-layer) |
| US3.2 | inaccessible folder informs user, writes nothing | PASS | notify fired, zero writes |
| US3.3 | removal deletes record + note together | PASS | |
| SC-001 | exactly one pair with matching managed fields | PASS | |
| SC-002 | hand-written body byte-for-byte unchanged | PASS | incl. non-ASCII body |
| SC-003 | re-collect → zero duplicate notes | PASS | |
| SC-004 | zero files outside the folder | PASS | asserted at store/relative-path layer |
| SC-004-fs | true on-disk folder-boundary (adapter) | SKIP | `ObsidianFileStore` path scoping only exercised in a live vault (T019) |
| SC-005 | pre-existing inconsistency reconciled on load | PASS | orphan record → note rebuilt, indexed |
| SC-006 | ~1000-paper index build under 2s, no resident vectors | PASS | built in well under 2s; embedding stays on disk |
| SC-006-ui | index build off the main render path (non-blocking) | SKIP | thread/UI concern owned by 008; not observable in a node harness |
| SC-007 | enriched fields + stored embedding survive updates | PASS | summary + non-null vector preserved; non-null replaces |
| SC-008 | record carries embedding; note has none | PASS | no embedding text in any note region |
| EC-1 | renamed files re-paired by content sourceId on load | PASS | no orphan mis-report |
| EC-2 | hand-edited managed field rebuilt from record; body kept | PASS | FR-010 |
| EC-3 | interrupted delete completed on next load | PASS | tombstone resume |
| EC-4 | orphan note (no tombstone) reported, not deleted | PASS | FR-013 |
| EC-5 | injective filenames for alike-sanitizing sourceIds | PASS | disambiguator appended |
| EC-6 | delete removes note incl. non-empty body | PASS | destructive delete |
| EC-7 | storage-folder change leaves old pairings + informs user | PASS | FR-018 |

## Known residual limitations

These are edge behaviors observed in the implementation that are **outside this suite's asserted scope** (notes, not failures — none contradicts a spec requirement):

- **Mid-session external rename** — the store trusts the in-memory index's filename stem during a session; a file renamed on disk while the plugin runs is only re-paired by content `sourceId` at the next `load()` (FR-017 mandates *no live watcher*). An `upsert` in the window between rename and reload could write to the old stem; it is reconciled on next load. This is the accepted lazy-detection tradeoff FR-017 fixes, not a defect.
- **Basis-cache naming seam** — `reconcile.classify()` treats any `*.json` as a paper record. If 006 were to name its projection-basis cache `*.json`, `load()` would emit a "skipped unreadable record" notice rather than ignoring it. 003 relies on 006 using a non-`.json`/`.md` cache name (FR-023 is satisfied for the tested `*.pg3dcache` form). Cross-feature naming convention, not a 003 gap.
- **On-disk folder boundary (SC-004-fs)** — the `InMemoryFileStore` cannot represent an out-of-folder write, so SC-004 is asserted only at the store's relative-path layer. The real filesystem boundary is enforced by `ObsidianFileStore` (`normalizePath` under `baseFolder`) and must be confirmed by the live-vault smoke (T019).
- **`migrate()` leniency** — a stored record with a malformed *non-embedding* wrapper field (e.g. a non-numeric `createdAt`) is coerced to a default rather than rejected. This matches FR-016's "migrate, don't reject" intent for schema evolution but is broader than the spec explicitly requires.

## Raw test run

```text
[PASS] US1.1 — newly collected paper -> both .json and .md created, keyed by sourceId
[PASS] US1.2 — note managed region mirrors the record's shared fields (FR-002 subset)
[PASS] US1.3 — partial persistence (note write fails) leaves neither record nor note
[PASS] US2.1 — update merges in place; no duplicate note
[PASS] US2.2 — user hand-written body is untouched by an update
[PASS] US2.3 — re-collecting identical data creates no duplicate; pairing stays consistent
[PASS] US3.1 — create/update/delete only ever touch paths inside the folder
[PASS] US3.2 — inaccessible storage folder informs the user and writes nothing elsewhere
[PASS] US3.3 — removal deletes both the record and the note together
[PASS] SC-001 — exactly one .json + one .md per new paper, with matching managed fields
[PASS] SC-002 — hand-written body byte-for-byte unchanged across an update
[PASS] SC-003 — re-collecting the same paper yields zero duplicate notes
[PASS] SC-004 — no path outside the designated folder is ever created/modified/deleted
[SKIP] SC-004-fs — true on-disk folder-boundary enforcement (adapter) (ObsidianFileStore path scoping is only exercised in a live vault (T019); asserted here only at the store/relative-path layer)
[PASS] SC-005 — a pre-existing inconsistency (record without note) is reconciled on load
[PASS] SC-006 — load builds the index for ~1000 papers under 2s, holding no embedding vectors
[SKIP] SC-006-ui — index build runs off the main render path without blocking the UI (thread/UI-blocking behavior is an 008 wiring concern, not observable in a node harness)
[PASS] SC-007 — enriched wrapper fields and a stored non-null embedding survive later updates
[PASS] SC-008 — record carries the embedding + metadata; zero embeddings appear anywhere in the note
[PASS] EC-1 — manually renamed files are re-paired by content sourceId on load (no duplicate)
[PASS] EC-2 — a hand-edited managed field is rebuilt from the record on next update; body untouched
[PASS] EC-3 — an interrupted delete (tombstone + record left) is completed on next load
[PASS] EC-4 — an orphan note with no tombstone is reported, never silently deleted
[PASS] EC-5 — distinct sourceIds that sanitize alike get distinct (injective) filenames
[PASS] EC-6 — deleting a paper removes its note including a non-empty hand-written body
[PASS] EC-7 — a storage-folder change leaves old pairings and informs the user (FR-018)
Summary: 24 passed, 0 failed, 2 skipped
```
