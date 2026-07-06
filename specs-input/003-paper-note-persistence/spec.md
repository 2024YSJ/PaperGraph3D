# Feature Specification: Paper Note Persistence (JSON + Markdown)

**Feature Branch**: `003-paper-note-persistence`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Save collected or updated paper information into the user's vault, while preserving anything the user wrote by hand. Every stored paper is maintained as two synchronized representations: a canonical JSON record that the plugin operates on, and a user-facing Markdown note the user reads and edits. The two are added together and removed together. Updates merge into the existing note rather than replacing it, and only plugin-managed fields may change — never the user's hand-written body. The plugin never touches any file outside the designated folder."

## Clarifications

### Session 2026-07-04

- Q: The plugin operates on JSON but the user works in Markdown — how are the two kept consistent on disk? → A: For each stored paper, the storage folder holds a paired canonical JSON record and a user-facing Markdown note, keyed by the paper's source identifier. The JSON record is the plugin's source of truth; the Markdown note is what the user opens. Adds write both; deletes remove both; updates rewrite the JSON record and merge the note's plugin-managed region — always as one coordinated operation so the two never drift apart.
- Q: When the plugin needs a field value, does it read the note or the JSON? → A: Always the JSON record. The Markdown note's plugin-managed region mirrors the record for the user's benefit, but the note body (and the note generally) is never parsed as authoritative plugin state. This keeps user edits from ever changing plugin behavior.
- Q: What is the boundary the plugin may and may not modify inside a note? → A: The note has a clearly delimited plugin-managed region (mirroring the JSON record's fields) and a free-form body owned entirely by the user. Merges only rewrite the managed region; the user body is never modified or deleted.
- Q: If the JSON record and Markdown note for a paper fall out of sync (one missing, or shared fields disagree), what happens? → A: That is an inconsistent state (this feature defines record/note consistency and what violates it). On the next operation touching that paper, the plugin reconciles by treating the JSON record as authoritative and rebuilding/repairing the note's managed region; a note with no record is reported to the user rather than silently deleted.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A note (and record) is created for every new paper (Priority: P1)

As a user, I want a note created automatically for every newly collected paper, backed by a JSON record the plugin uses internally, so that my papers appear in my vault without manual work and the plugin has a reliable data source.

**Why this priority**: Persistence is what turns transient collection results into durable, user-visible content; every later feature (graph, refresh) reads what this feature writes.

**Independent Test**: Feed a canonical Paper Record to the feature and confirm both a JSON record and a Markdown note appear in the designated folder, keyed by the paper's source identifier, with the note's managed region mirroring the record.

**Acceptance Scenarios**:

1. **Given** a newly collected paper, **When** it is persisted, **Then** both a JSON record and a Markdown note are created together in the designated folder, keyed by the paper's source identifier.
2. **Given** a persisted paper, **When** its note is opened, **Then** the note's plugin-managed region shows the same field values as the JSON record.
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
- If a JSON record exists without a matching note (or vice versa), the plugin reconciles on the next operation: the record is authoritative and the note's managed region is rebuilt; a note with no record is reported to the user, never silently deleted.
- If note filenames could collide for different papers, the naming rule (derived from the globally unique source identifier) must prevent it.
- If a delete removes the note but the record removal fails (or vice versa), the operation must be recoverable so the pairing does not remain half-deleted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: For every newly collected paper, the feature MUST create a paired JSON record and Markdown note together in the designated storage folder, keyed by the paper's source identifier.
- **FR-002**: The JSON record MUST be the plugin's source of truth; the Markdown note's plugin-managed region MUST mirror the record's field values for the user to read.
- **FR-003**: Adds, updates, and deletes MUST keep the JSON record and Markdown note synchronized as one coordinated operation — the two are never left in a state where one exists without the other, or their shared fields disagree, once an operation has completed.
- **FR-004**: When updated information arrives for a paper that already has a record and note, the existing pairing MUST be merged/updated in place rather than replaced with a new note; no duplicate note may be created.
- **FR-005**: During a merge, only the plugin-managed region of the note and the JSON record may change; the user's free-form body region MUST never be modified or deleted.
- **FR-006**: All creation, modification, and deletion MUST happen only within the folder the user designated in settings; no file outside it may ever be created, modified, or deleted.
- **FR-007**: Note filenames MUST follow a rule, derived from the globally unique source identifier, that prevents different papers from colliding.
- **FR-008**: If the same paper is persisted again, the feature MUST update the existing pairing rather than create a duplicate.
- **FR-009**: If a user manually renames a note file, the feature MUST still locate that paper by its source identifier and merge correctly instead of creating a duplicate.
- **FR-010**: If a user manually edits a plugin-managed field in the note, the next update MUST rebuild the managed region from the authoritative JSON record; the user's body region MUST remain untouched.
- **FR-011**: If the storage folder is missing or inaccessible, the feature MUST inform the user and MUST NOT leave a half-created or half-deleted record/note pairing.
- **FR-012**: When a paper is removed, both its JSON record and its Markdown note MUST be deleted together.
- **FR-013**: If a record exists without a note or a note without a record, the feature MUST reconcile on the next operation touching that paper, treating the JSON record as authoritative; a note with no record MUST be reported to the user rather than silently deleted.
- **FR-014**: Writes to a single paper's pairing MUST be serialized: concurrent operations targeting the same paper — e.g., a collection update (002), a summarization result (004), and a manual refresh (005) — MUST NOT interleave into a partial or inconsistent state. Each completes atomically with respect to the others (or is safely ordered), so the record and note are never left disagreeing.
- **FR-015**: This feature MUST expose a read capability over the stored records — at minimum an existence check by source identifier (does a record for this `sourceId` already exist?) and a way to read stored records back into their canonical `Paper` (001) shape — since it owns the on-disk store and is the only feature that reads it. Collection (002) depends on the existence check for its dedup/"already-persisted" skip (002 FR-009), refresh (005) depends on reading a single record back before updating it, and graph conversion (006) depends on reading all records back; none of those features may read the vault files directly. Whether this read is served from an in-memory index or from on-demand file reads is an implementation choice (see Open Questions OQ-6/OQ-8), but the capability itself is a requirement, not optional.

### Key Entities

- **Paper Record (JSON)**: The canonical, plugin-operated persistence form of a Paper (whose logical shape is defined in 001). Carries every field the plugin needs to run without reading any Markdown; it is the source of truth. **Defined and owned by this feature** — it writes, updates, and deletes it.
- **Paper Note (Markdown)**: The user-facing persistence form of the same Paper — a clearly delimited plugin-managed region that mirrors the record, plus a free-form body region owned entirely by the user. **Defined and owned by this feature** — it writes the managed region only, never the body.
- **Storage Folder**: The user-designated vault folder (default from 001 settings) that is the sole location this feature may touch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every newly collected paper results in exactly one JSON record and one Markdown note, created together, with matching managed fields.
- **SC-002**: After a user adds hand-written text to a note body and the paper is later updated, the hand-written text is byte-for-byte unchanged 100% of the time.
- **SC-003**: Re-collecting the same paper creates zero duplicate notes; the existing pairing is updated instead.
- **SC-004**: Zero files outside the designated storage folder are ever created, modified, or deleted by the plugin.
- **SC-005**: After any completed add/update/delete, zero papers are left with a record-without-note or note-without-record inconsistency; any pre-existing inconsistency is reconciled on the next operation.

## Assumptions

- The JSON record is the plugin's own normalized schema (a serialized canonical Paper, 001), not a provider's wire format. This feature never sees a raw provider payload — arXiv Atom XML and Semantic Scholar JSON are parsed and normalized upstream in 002. Here, both the JSON record and the Markdown note are internal, plugin-owned representations; "the plugin operates on JSON" always means this internal record, never a provider's JSON.
- The paired on-disk layout is a `.json` file and a `.md` file sharing a filename derived from the source identifier, both inside the storage folder; this concrete layout realizes this feature's record/note synchronization invariant. (If the user later prefers a single JSON index instead of per-paper JSON files, that is a layout change confined to this feature and does not alter the record/note synchronization contract.)
- The plugin-managed region of the note is delimited so it can be rewritten wholesale without ambiguity about where the user's body begins.
- The canonical Paper Record content arrives from collection (002) or refresh (005); this feature does not fetch from external providers.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — Record schema vs the `Paper` interface.** Is the on-disk JSON exactly a serialized `Paper` (001), or a superset carrying metadata — read/unread, summary, future-directions text, an "enriched" flag, created/updated timestamps, a **schema version**? The concrete record schema must be fixed here.
- **OQ-2 — Managed-region format in the note.** YAML frontmatter, a delimited comment block (e.g. `<!-- pg3d --> … <!-- /pg3d -->`), or a dedicated heading section?
- **OQ-3 — Which fields the note mirrors.** All record fields (including raw reference `sourceId`s) or a human-readable subset? Define exactly which fields are "shared" for the consistency invariant (FR-002).
- **OQ-4 — Rendering of list fields** (authors, references) in the note.
- **OQ-5 — Where `sourceId` is recovered after a manual rename.** FR-009 requires locating the paper by `sourceId` after a rename, but the plugin never parses the note body — so is `sourceId` read from the filename, the JSON content, or the note frontmatter? (If from the filename, a rename breaks the link.)
- **OQ-6 — In-memory index vs on-demand reads.** Does the plugin keep a session-long in-memory map of records, or read JSON files on demand for each operation (dedup, graph build, toggles)? *(Answers "is the Paper object kept resident?")*
- **OQ-7 — External change detection.** Does the plugin watch for and reload external edits/deletes of the JSON or MD files?
- **OQ-8 — Load-time scan cost.** Is there a full scan of the storage folder at startup to build the index, and how does it scale to many papers?
- **OQ-9 — Per-paper JSON files vs a single JSON index.** The current assumption is per-paper `.json` sidecars; finalize this vs one consolidated index.
- **OQ-10 — Schema versioning / migration** of records across future field additions.
- **OQ-11 — Storage-location change.** If the user changes the storage folder after data exists, are existing pairings moved, left in place, or re-created?
- **OQ-12 — Multi-device sync conflicts.** Obsidian Sync or git editing the same JSON/MD on two devices — how are conflicts detected/resolved?

## Out of Scope

- Where papers come from (external collection) is owned by 002.
- Generating summaries or future-directions text is owned by 004.
- Reading notes/records back into graph data is owned by 006 — but the underlying read/existence-check capability those readers call is exposed by *this* feature (FR-015); 006 assembles graph data from it, it does not read vault files itself.
- Deleting a paper as a user action from the graph is triggered by 007 but performed through this feature's coordinated delete.
