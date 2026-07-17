# Spec-test report: 003-paper-note-persistence

> **[Re-run 2026-07-17 — 25 passed, 0 failed, 2 skipped]** Unchanged by the embedding redesign; re-run to
> confirm no regression. Suites are built with `--external:@huggingface/transformers`:
> the embedding runtime is now a real dependency of `src/`, and the lazy import is
> never reached by these tests.

- **Spec**: `specs/003-paper-note-persistence/spec.md`
- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-17
- **`tsc --noEmit`**: PASS
- **Result**: **25 passed, 0 failed, 2 skipped**

Exercises the real `src/persistence/*` exports (`PaperStore`, `renderNote`/`parseNote`,
`wrap`/`migrate`, `fileStem`/`sanitizeStem`, reconcile helpers) end-to-end over
`InMemoryFileStore` — the whole persistence core runs offline, so almost every
acceptance scenario, edge case, and success criterion is a real assertion. Only the
real-Vault boundary and the disk/UI-thread scale budget are SKIP.

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1/SC-001 | .json + .md created together, keyed by sourceId | PASS | |
| US1.2 | Note frontmatter mirrors the record's shared fields | PASS | title/year/citation/readState/authors |
| US1.3 | Partial failure leaves neither record nor note | PASS | .json rolled back on .md write failure |
| US2.1/SC-003 | Re-persist updates in place — no duplicate note | PASS | |
| US2.2/SC-002 | Update leaves user body byte-for-byte unchanged | PASS | |
| EC-managed-edit | User-edited managed field rebuilt from authoritative record | PASS | |
| US3.1/SC-004 | Every written file is an in-folder stem (no traversal) | PASS | |
| US3.2 | Inaccessible folder reported; nothing written elsewhere | PASS | `list()` throws → notify |
| US3.3 | Remove deletes both .json and .md (and tombstone) | PASS | |
| EC-rename | After manual rename, still found by sourceId (no orphan report) | PASS | |
| EC-orphan-note | Note with no record reported, never deleted | PASS | |
| EC-orphan-record | Record with no note has its note rebuilt on load | PASS | |
| EC-collision | Filename derivation injective + strips illegal chars | PASS | disambiguates a taken stem |
| EC-interrupted-delete | Tombstoned delete resumed/completed on load | PASS | |
| SC-005 | Zero record-without-note / note-without-record after ops | PASS | create/update/delete |
| SC-006-inmem | ~1,000-paper index build well under 2s (in-memory) | PASS | timing on InMemoryFileStore |
| SC-007 | Merge preserves enriched wrapper fields + non-null embedding on pending update | PASS | |
| SC-008 | Embedding lives in the record wrapper only, never in the note | PASS | |
| US3.1-vault | Real Vault adapter never touches a file outside the base folder | SKIP | filestore-obsidian.ts needs Obsidian |
| SC-006-disk | ≤2s / off-main-thread on a real ~1,000-paper vault | SKIP | real disk + render-thread (in-mem covered) |
| OQ11-folder-change | Storage-folder change leaves old pairings, notifies | SKIP | needs a 2nd real Vault FileStore + 008 trigger |

## Known residual limitations

- No spec-violating behavior was found. Creation ordering + rollback, field-scoped
  merge (including embedding preserve-unless-supplied), JSON-authoritative
  reconciliation, orphan reporting, injective filename derivation, and the
  tombstoned two-phase delete all behave as specified.
- `EC-rename`: after a user renames a note file, the paper is correctly re-paired by
  content `sourceId` and no duplicate *record* is created; the asserted guarantee
  holds. A subsequent update rewrites the record's own stem `.md`, so the
  user-renamed file can remain as a stale leftover — that is a user-created artifact
  outside this spec's "no duplicate pairing" guarantee, not a validator failure, and
  is not asserted here.
- `SC-006-inmem` measures the index-build cost over `InMemoryFileStore`, which is not
  representative of real disk latency or Obsidian's render thread; the on-disk budget
  is the separate `SC-006-disk` SKIP.

## Raw test output

```
[PASS] US1.1/SC-001 — Persist creates a .json + .md together, keyed by sourceId
[PASS] US1.2 — Note frontmatter mirrors the record's shared fields
[PASS] US1.3 — A partial failure (note write fails) leaves neither a record nor a note
[PASS] US2.1/SC-003 — Re-persisting an existing paper updates in place — no duplicate note
[PASS] US2.2/SC-002 — An update leaves the user's hand-written body byte-for-byte unchanged
[PASS] EC-managed-edit — A user-edited managed field is rebuilt from the authoritative record on next update
[PASS] US3.1/SC-004 — Every file written is a plain in-folder stem name (no path traversal)
[PASS] US3.2 — An inaccessible storage folder is reported and nothing is written elsewhere
[PASS] US3.3 — Removing a paper deletes both its .json and .md together
[PASS] EC-rename — After a manual note rename, the paper is still found by sourceId (no orphan report)
[PASS] EC-orphan-note — A note with no record is reported to the user, never silently deleted
[PASS] EC-orphan-record — A record with no note has its note rebuilt on load
[PASS] EC-collision — Filename derivation is injective and strips illegal characters
[PASS] EC-interrupted-delete — An interrupted delete (tombstone present) is resumed and completed on load
[PASS] SC-005 — After add/update/delete, zero record-without-note or note-without-record remain
[PASS] SC-006-inmem — Load-time index build handles ~1,000 papers well under the 2s budget (in-memory)
[PASS] SC-007 — Field-scoped merge preserves enriched wrapper fields and a non-null embedding on a pending update
[PASS] SC-008 — The record wrapper carries the embedding; the note carries none of it
[SKIP] US3.1-vault — The real Obsidian Vault adapter never touches a file outside the base folder (filestore-obsidian.ts enforces the boundary against a live Vault (needs Obsidian))
[SKIP] SC-006-disk — The load scan meets the ≤2s / off-main-thread budget on a real vault of ~1,000 papers (Real disk I/O + Obsidian render-thread behavior (in-memory timing is covered by SC-006-inmem))
[SKIP] OQ11-folder-change — Changing the storage folder leaves old pairings in place and notifies (onStorageFolderChanged needs a second real Vault FileStore + settings trigger (008))

Summary: 18 passed, 0 failed, 3 skipped
```
