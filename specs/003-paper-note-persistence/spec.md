# Feature Specification: Paper Note Persistence (JSON + Markdown)

**Feature Branch**: `develop-feature/003-paper-note-persistence`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Save collected or updated paper information into the user's vault, while preserving anything the user wrote by hand. Every stored paper is maintained as two synchronized representations: a canonical JSON record that the plugin operates on, and a user-facing Markdown note the user reads and edits. The two are added together and removed together. Updates merge into the existing note rather than replacing it, and only plugin-managed fields may change — never the user's hand-written body. The plugin never touches any file outside the designated folder."

## Clarifications

### Session 2026-07-04

- Q: The plugin operates on JSON but the user works in Markdown — how are the two kept consistent on disk? → A: For each stored paper, the storage folder holds a paired canonical JSON record and a user-facing Markdown note, keyed by the paper's source identifier. The JSON record is the plugin's source of truth; the Markdown note is what the user opens. Adds write both; deletes remove both; updates rewrite the JSON record and merge the note's plugin-managed region — always as one coordinated operation so the two never drift apart.
- Q: When the plugin needs a field value, does it read the note or the JSON? → A: Always the JSON record. The Markdown note's plugin-managed region mirrors the record for the user's benefit, but the note body (and the note generally) is never parsed as authoritative plugin state. This keeps user edits from ever changing plugin behavior.
- Q: What is the boundary the plugin may and may not modify inside a note? → A: The note has a clearly delimited plugin-managed region (mirroring the JSON record's fields) and a free-form body owned entirely by the user. Merges only rewrite the managed region; the user body is never modified or deleted.
- Q: If the JSON record and Markdown note for a paper fall out of sync (one missing, or shared fields disagree), what happens? → A: That is an inconsistent state (this feature defines record/note consistency and what violates it). On the next operation touching that paper, the plugin reconciles by treating the JSON record as authoritative and rebuilding/repairing the note's managed region; a note with no record is reported to the user rather than silently deleted.

### Session 2026-07-07

- Q: What does the on-disk JSON record contain (record schema)? → A: A "wrapped superset" — a serialized `Paper` (001) nested under a `paper` field, plus persistence and cross-feature metadata on the wrapper: `schemaVersion`, `createdAt`/`updatedAt`, `readState`, and reserved `summary`/`futureDirections` slots (populated by 004). One versioned record type that later features extend rather than replace. (Resolves OQ-1, OQ-10.)
- Q: How are records laid out on disk? → A: Per-paper sidecars — each paper is one `.json` record plus one `.md` note, keyed by its source identifier, both inside the storage folder. Writes are isolated per paper, so one paper's failure or sync conflict stays confined to that paper. (Resolves OQ-9.)
- Q: How is the plugin-managed region delimited inside the note? → A: YAML frontmatter at the top of the note holds the mirrored fields (including `pg3d_sourceId`); everything below the frontmatter is the user's free-form body. Merges rewrite the frontmatter wholesale and never touch the body. (Resolves OQ-2.)
- Q: How is a paper's sourceId recovered after a manual file rename? → A: From file content, never the filename — the `.json` carries `sourceId` and the note's frontmatter carries `pg3d_sourceId`; pairing is established by matching these content-level source identifiers, so renaming either file preserves the link. The user's free-form body is still never parsed. (Resolves OQ-5.)
- Q: Does the plugin keep records resident in memory or read them on demand? → A: A session-long in-memory index (`sourceId` → record) is built at load and kept synchronized with disk on every write; reads (dedup, graph build, read-state toggles) hit memory. Disk remains the authoritative source of truth. (Resolves OQ-6.)
- Q: Which record fields does the note frontmatter mirror (the "shared fields" for FR-002)? → A: A human-readable subset — `title`, `authors`, `publicationYear`, `citationCount`, `readState`, and `pg3d_sourceId`. Raw `references` sourceId arrays, `schemaVersion`, and timestamps stay in the JSON record only. The FR-002 consistency invariant is defined over exactly this mirrored subset. (Resolves OQ-3.)
- Q: How does the plugin detect external/sync edits to its files? → A: Lazily — no live file watcher. The index is built at load and reconciled per paper on the next operation touching it (FR-013); whole-index consumers (e.g., graph build) may trigger a fresh scan. Live watching is a possible future enhancement. (Resolves OQ-7.)
- Q: Is there a scale target for the startup scan / index build? → A: Yes — the full load-time scan MUST handle personal-library scale without blocking the UI: target ≈ 1,000 papers indexed in ≤ 2 seconds, performed off the main render path. Captured as a measurable Success Criterion. (Resolves OQ-8.)
- Q: What happens to existing pairings when the user changes the storage folder? → A: They are left in place at the old folder — never bulk-moved or re-created. The plugin operates on the new folder going forward and notifies the user that existing papers remain in the old location. (Resolves OQ-11.)
- Q: How are multi-device sync conflicts handled? → A: Delegated to the sync layer (Obsidian Sync / git); the plugin treats on-disk state as truth and relies on JSON-authoritative per-paper reconciliation (FR-013) to repair any note/record disagreement on next touch. Per-paper sidecars confine conflicts to the affected paper. The plugin implements no merge logic of its own; a dedicated conflict-resolution UI is out of scope for v1. (Resolves OQ-12.)
- Q: When an update carries new paper fields, what happens to record fields owned by other features (e.g., 004's `summary`)? → A: Field-scoped merge — an update overwrites only the fields it actually carries (the `paper` fields it provides, plus `updatedAt`) and preserves every wrapper field it does not explicitly set (`summary`, `futureDirections`, `readState`, `createdAt`). Updates extend, never clobber, cross-feature data.
- Q: Deleting a paper removes the whole note, including the user's hand-written body — how is that handled? → A: This feature performs the coordinated delete of the `.json`+`.md` pair as one operation (body included); surfacing any warning/confirmation about losing a hand-written body is the caller's responsibility (the delete is triggered by 007). The user-content preservation guarantee (FR-005 / SC-002) applies to updates only, not deletes — this is stated explicitly.
- Q: After an interrupted delete leaves an orphan file, how does reconciliation tell a "delete leftover" from an orphan to preserve? → A: Tombstone two-phase delete — the operation first records a pending-delete marker/tombstone, then removes the note, then removes the record. An interrupted delete is *resumed and completed* on the next touch. Only an orphan with no delete marker falls under FR-013's "report, never silently delete." This also fixes create ordering: the record (`.json`) is written durably before the note so a half-create leaves a record the note can be rebuilt from.
- Q: What are the defaults, values, and ownership for `readState` and the timestamps? → A: This feature owns the record fields' bookkeeping: on create `readState = 'unread'` and `createdAt = updatedAt = now`; every persisted update sets `updatedAt = now` and preserves `createdAt`. `readState ∈ {unread, read}`. The read/unread *toggle UI/action* is owned by the consuming feature (e.g., 007); this feature only provides the persistence path that writes a changed `readState`.
- Q: How is a collision-free filename derived from a `sourceId` that contains `:` (illegal on Windows)? → A: A readable, injective sanitization — the `provider` prefix plus a sanitized local part (e.g. `arxiv:2401.12345` → `arxiv_2401.12345`), replacing only filesystem-illegal/reserved characters while guaranteeing that two different `sourceId`s never map to the same filename (append a disambiguator on the rare collision). The content-level `sourceId` remains the true key (FR-009), so the filename need not be reversible.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A note (and record) is created for every new paper (Priority: P1)

As a user, I want a note created automatically for every newly collected paper, backed by a JSON record the plugin uses internally, so that my papers appear in my vault without manual work and the plugin has a reliable data source.

**Why this priority**: Persistence is what turns transient collection results into durable, user-visible content; every later feature (graph, refresh) reads what this feature writes.

**Independent Test**: Feed a canonical Paper Record to the feature and confirm both a JSON record and a Markdown note appear in the designated folder, keyed by the paper's source identifier, with the note's managed region mirroring the record's shared (mirrored) fields per FR-002.

**Acceptance Scenarios**:

1. **Given** a newly collected paper, **When** it is persisted, **Then** both a JSON record and a Markdown note are created together in the designated folder, keyed by the paper's source identifier.
2. **Given** a persisted paper, **When** its note is opened, **Then** the note's plugin-managed region (frontmatter) shows the same values as the JSON record for the shared mirrored fields defined in FR-002.
3. **Given** persistence fails partway (e.g., the note could not be written), **When** the operation ends, **Then** it does not leave a JSON record without a note or a note without a record — the pairing is either fully created or not created.

---

### User Story 2 - Updates merge without destroying user writing (Priority: P1)

As a user, I want updated paper information to merge into the existing note and record rather than replacing them, and I want any notes I typed by hand to survive every future update.

**Why this priority**: The plugin's trust depends on never destroying user work; a merge that clobbered hand-written notes would make the plugin unsafe to use.

**Independent Test**: Persist a paper, add hand-written text to the note body, feed an updated Paper Record with new field values, and confirm the managed region and JSON record update while the hand-written body is byte-for-byte unchanged.

**Acceptance Scenarios**:

1. **Given** a paper that already has a record and note, **When** updated information arrives, **Then** the existing record and note are merged/updated in place — no duplicate note is created.
2. **Given** a note whose body the user edited, **When** the paper is updated, **Then** only the plugin-managed region and the JSON record change; the user's body region is untouched.
3. **Given** the same paper is collected again with identical data, **When** it is persisted, **Then** no duplicate note is created and the existing pairing is left consistent.

---

### User Story 3 - The plugin stays inside its designated folder (Priority: P1)

As a user, I want this plugin to only ever create, modify, or delete files inside the folder I designated, so that nothing else in my vault is ever at risk.

**Why this priority**: A vault contains the user's entire body of work; a plugin that writes outside its lane is unacceptable regardless of its other features.

**Independent Test**: Point the storage location at a folder, run create/update/delete operations, and confirm no file outside that folder is ever created, modified, or deleted.

**Acceptance Scenarios**:

1. **Given** a designated storage folder, **When** any create, update, or delete runs, **Then** every affected file is inside that folder.
2. **Given** the storage folder does not exist or cannot be accessed, **When** an operation is attempted, **Then** the user is informed and no file is written elsewhere.
3. **Given** a paper is removed, **When** the removal runs, **Then** both its JSON record and its Markdown note are deleted together, and nothing outside the folder is touched.

---

### Edge Cases

- If a user manually renames a note file, the system must still find that paper (via the source identifier carried in the paired record / managed region) and merge correctly rather than creating a duplicate.
- If a user manually edits a plugin-managed field inside the note, a policy must exist for whether the next update overwrites it: the JSON record is authoritative, so the managed region is rebuilt from the record on the next update, but the user's free-form body is never touched.
- If the storage folder doesn't exist or can't be accessed, the user must be informed and no partial write may leave a record/note pairing half-created.
- If a JSON record exists without a matching note (or vice versa), the plugin reconciles on the next operation: the record is authoritative and the note's managed region is rebuilt; a genuine orphan note with no record (and no pending-delete tombstone) is reported to the user, never silently deleted.
- If note filenames could collide for different papers, the injective sanitization rule (derived from the globally unique source identifier) must prevent it, disambiguating on the rare clash.
- If a delete removes the note but the record removal fails (or vice versa), the pending-delete tombstone lets the operation resume and complete on the next touch, so the pairing does not remain half-deleted.
- If a paper is deleted while its note holds a non-empty hand-written body, the body is removed with the note (delete is destructive and outside the preservation guarantee); the confirmation/warning is the responsibility of the triggering feature (007).
- If an update arrives for a paper that another feature has enriched (e.g., 004 wrote a summary), the field-scoped merge must preserve those wrapper fields and change only the fields the update carries.
- If the user changes the storage folder while data exists, existing pairings are left in place in the old folder (never bulk-moved or deleted); the plugin operates on the new folder and tells the user where the old papers remain.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For every newly collected paper, the feature MUST create a paired JSON record and Markdown note together in the designated storage folder, keyed by the paper's source identifier.
- **FR-002**: The JSON record MUST be the plugin's source of truth; the Markdown note's plugin-managed region MUST mirror the record's field values for the user to read. The managed region is the note's **YAML frontmatter** (holding the mirrored fields, including `pg3d_sourceId`); everything below the frontmatter is the user's free-form body. The mirrored (**shared**) fields are a human-readable subset — `title`, `authors`, `publicationYear`, `citationCount`, `readState`, and `pg3d_sourceId`; raw `references` sourceId arrays, `schemaVersion`, and timestamps live only in the JSON record. The FR-002 consistency invariant is defined over exactly this shared subset.
- **FR-003**: Adds, updates, and deletes MUST keep the JSON record and Markdown note synchronized as one coordinated operation — the two are never left in a state where one exists without the other, or their shared fields disagree, once an operation has completed.
- **FR-004**: When updated information arrives for a paper that already has a record and note, the existing pairing MUST be merged/updated in place rather than replaced with a new note; no duplicate note may be created. The merge MUST be **field-scoped**: an update overwrites only the fields it actually carries (the `paper` fields it supplies, plus `updatedAt`) and MUST preserve every wrapper field it does not explicitly set — in particular `summary`, `futureDirections`, `readState`, and `createdAt` owned/written by other features MUST survive an update from collection (002) or refresh (005).
- **FR-005**: During a merge, only the plugin-managed region of the note and the JSON record may change; the user's free-form body region MUST never be modified or deleted.
- **FR-006**: All creation, modification, and deletion MUST happen only within the folder the user designated in settings; no file outside it may ever be created, modified, or deleted.
- **FR-007**: Each paper MUST be stored as a paired `.json` record and `.md` note (per-paper sidecars) inside the storage folder, whose filenames are derived from the globally unique source identifier by a **readable, injective sanitization** — the `provider` prefix plus a sanitized local part (e.g. `arxiv:2401.12345` → `arxiv_2401.12345`), replacing only filesystem-illegal/reserved characters and guaranteeing that two different source identifiers never map to the same filename (appending a disambiguator on the rare collision). The filename need not be reversible; the content-level source identifier remains the true key (FR-009). Each paper's write MUST be isolated so a failure or sync conflict on one paper does not affect another.
- **FR-008**: If the same paper is persisted again, the feature MUST update the existing pairing rather than create a duplicate.
- **FR-009**: If a user manually renames a note or record file, the feature MUST still locate that paper by its source identifier — read from **file content** (the `.json`'s `sourceId` and the note frontmatter's `pg3d_sourceId`), never from the filename — and merge correctly instead of creating a duplicate. The user's free-form body MUST NOT be parsed for this purpose.
- **FR-010**: If a user manually edits a plugin-managed field in the note, the next update MUST rebuild the managed region from the authoritative JSON record; the user's body region MUST remain untouched.
- **FR-011**: If the storage folder is missing or inaccessible, the feature MUST inform the user and MUST NOT leave a half-created or half-deleted record/note pairing.
- **FR-012**: When a paper is removed, both its JSON record and its Markdown note MUST be deleted together as one coordinated operation, including any hand-written body in the note. Deletion is destructive to the user's body and is explicitly **outside** the user-content preservation guarantee (FR-005 / SC-002), which applies to updates only. Because the delete is triggered by 007, surfacing any warning/confirmation about losing a non-empty hand-written body is the caller's (007's) responsibility; this feature performs the coordinated delete.
- **FR-013**: If a record exists without a note or a note without a record, the feature MUST reconcile on the next operation touching that paper, treating the JSON record as authoritative; a note with no record MUST be reported to the user rather than silently deleted. This "report, never silently delete" rule applies only to a genuine orphan — a note whose paper has **no pending-delete tombstone** (FR-021). An orphan left by an interrupted delete carries a tombstone and MUST be completed as a delete, not reported.
- **FR-014**: Writes to a single paper's pairing MUST be serialized: concurrent operations targeting the same paper — e.g., a collection update (002), a summarization result (004), and a manual refresh (005) — MUST NOT interleave into a partial or inconsistent state. Each completes atomically with respect to the others (or is safely ordered), so the record and note are never left disagreeing.
- **FR-015**: The feature MUST maintain a session-long in-memory index keyed by source identifier (`sourceId` → record), built when the storage folder is loaded and kept synchronized with disk on every add/update/delete. Reads that other features rely on (deduplication, graph build, read-state toggles) MUST be servable from this index; disk remains the authoritative source of truth, so the index MUST reflect what was durably written.
- **FR-016**: The JSON record MUST be a versioned "wrapped superset": a serialized `Paper` (001) nested under a `paper` field, plus wrapper-level persistence and cross-feature metadata — at minimum `schemaVersion`, `createdAt`, `updatedAt`, `readState`, and reserved `summary`/`futureDirections` slots (owned/populated by 004). The `schemaVersion` MUST be present so future field additions can be migrated. Later features MUST extend this one record type rather than introduce parallel per-paper stores.
- **FR-017**: External-change detection MUST be lazy: the feature MUST NOT require a live file watcher. The in-memory index (FR-015) is built at load, and any note/record inconsistency introduced externally is reconciled per paper on the next operation touching it (FR-013); a whole-index consumer (e.g., graph build) MAY trigger a fresh scan. (A live vault-event watcher is an allowable future enhancement but MUST NOT be required for correctness.)
- **FR-018**: When the user changes the storage folder in settings while data exists, the feature MUST leave existing pairings in place at the old folder — it MUST NOT bulk-move, re-create, or delete them — and MUST operate on the new folder going forward, rebuilding the in-memory index (FR-015) from the new folder and informing the user that previously stored papers remain in the old location.
- **FR-019**: Multi-device / external sync conflicts on the same files MUST be delegated to the sync layer (e.g., Obsidian Sync, git); the feature MUST treat on-disk state as truth and rely on JSON-authoritative per-paper reconciliation (FR-013) to repair any resulting note/record disagreement on next touch. The feature MUST NOT implement its own merge or conflict-resolution logic; per-paper sidecars keep any conflict confined to the affected paper.
- **FR-020**: The feature owns the record's bookkeeping fields. On create it MUST set `readState = 'unread'` and `createdAt = updatedAt =` the creation time; on every persisted update it MUST set `updatedAt` to the update time and preserve the original `createdAt`. `readState` MUST be one of `unread` or `read`. The user-facing read/unread **toggle action/UI** is owned by the consuming feature (e.g., 007); this feature only provides the persistence path that durably writes a changed `readState`.
- **FR-021**: Deletes MUST be tombstoned and two-phase so an interrupted delete is recoverable and unambiguous: the operation first records a pending-delete marker (tombstone) for the paper, then removes the note, then removes the record (and finally the tombstone). On the next operation or load, a paper carrying a tombstone MUST have its delete **resumed and completed**, distinct from a genuine orphan (FR-013). Correspondingly, on create the record (`.json`) MUST be written durably before the note (`.md`); a *detected* create failure still rolls back to "neither exists" per FR-011/US1.3, and this ordering only governs an **uncontrolled interruption** (e.g., a crash), where the surviving record lets reconciliation rebuild the note rather than stranding a note with no record.

### Key Entities

- **Paper Record (JSON)**: The canonical, plugin-operated persistence form of a Paper (whose logical shape is defined in 001). A versioned **wrapped superset**: the serialized `Paper` nested under a `paper` field, plus wrapper metadata (`schemaVersion`, `createdAt`, `updatedAt`, `readState`, and reserved `summary`/`futureDirections` slots). Carries every field the plugin needs to run without reading any Markdown; it is the source of truth. Stored as one `.json` file per paper. Updates to it are **field-scoped** (they preserve wrapper fields owned by other features), and its deletion is guarded by a short-lived **pending-delete tombstone** so an interrupted delete can be completed. **Defined and owned by this feature** — it writes, updates, and deletes it; later features extend its wrapper metadata rather than create parallel stores.
- **Paper Note (Markdown)**: The user-facing persistence form of the same Paper, one `.md` file per paper. Its **YAML frontmatter** is the plugin-managed region (mirroring the record's shared fields, including `pg3d_sourceId`); everything below the frontmatter is a free-form body region owned entirely by the user. **Defined and owned by this feature** — it writes the frontmatter only, never the body.
- **Record Index (in-memory)**: A session-long map from `sourceId` to Paper Record, built when the storage folder loads and kept in sync with disk on every write. It is the fast read path for dedup, graph build, and read-state toggles; it is a cache of the authoritative on-disk records, not a second source of truth. **Owned by this feature.**
- **Storage Folder**: The user-designated vault folder (default from 001 settings) that is the sole location this feature may touch. Holds the paired per-paper `.json` and `.md` files.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every newly collected paper results in exactly one JSON record and one Markdown note, created together, with matching managed fields.
- **SC-002**: After a user adds hand-written text to a note body and the paper is later updated, the hand-written text is byte-for-byte unchanged 100% of the time.
- **SC-003**: Re-collecting the same paper creates zero duplicate notes; the existing pairing is updated instead.
- **SC-004**: Zero files outside the designated storage folder are ever created, modified, or deleted by the plugin.
- **SC-005**: After any completed add/update/delete, zero papers are left with a record-without-note or note-without-record inconsistency; any pre-existing inconsistency is reconciled on the next operation.
- **SC-006**: The load-time scan builds the in-memory index for a personal-library scale of ~1,000 papers in under 2 seconds without blocking the UI.
- **SC-007**: After a feature enriches a paper (e.g., a summary is written) and collection or refresh later updates the same paper's fields, the enriched wrapper fields (`summary`, `futureDirections`, `readState`, `createdAt`) are preserved 100% of the time.

## Assumptions

- The JSON record is the plugin's own normalized schema (a serialized canonical Paper, 001), not a provider's wire format. This feature never sees a raw provider payload — arXiv Atom XML and Semantic Scholar JSON are parsed and normalized upstream in 002. Here, both the JSON record and the Markdown note are internal, plugin-owned representations; "the plugin operates on JSON" always means this internal record, never a provider's JSON.
- The paired on-disk layout is decided (Session 2026-07-07): per-paper sidecars — one `.json` record and one `.md` note per paper, filenames derived from the source identifier, both inside the storage folder. This concrete layout realizes this feature's record/note synchronization invariant.
- The plugin-managed region of the note is its YAML frontmatter (decided Session 2026-07-07), so it can be rewritten wholesale without ambiguity about where the user's body begins.
- The canonical Paper Record content arrives from collection (002) or refresh (005); this feature does not fetch from external providers.

## Open Questions

*All originally-recorded open questions have been resolved through the Session 2026-07-07 clarifications and folded into the Requirements, Key Entities, Success Criteria, and Assumptions above — except the one presentation detail below, which does not block planning.*

- **OQ-4 — Rendering of list fields** (authors, references) in the note frontmatter. A YAML-formatting/presentation choice safe to settle during `/speckit-plan`; it does not affect the consistency contract (the shared subset in FR-002 already excludes raw `references`).

## Out of Scope

- Where papers come from (external collection) is owned by 002.
- Generating summaries or future-directions text is owned by 004.
- Reading notes/records back into graph data is owned by 006.
- Deleting a paper as a user action from the graph is triggered by 007 but performed through this feature's coordinated delete.
