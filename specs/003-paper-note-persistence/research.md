# Phase 0 Research: Paper Note Persistence (JSON + Markdown)

The spec's `/speckit-clarify` rounds (Sessions 2026-07-04/07/08) already resolved every original Open Question except **OQ-4** (a presentation detail). The research below settles OQ-4 and the remaining *technical* decisions needed to turn the spec's behavior into a concrete, testable TypeScript design, informed by how 002 (collection/dedup), 005 (refresh/read-back), and 006 (graph enumeration) consume this feature.

## 1. File I/O boundary — a FileStore port with an Obsidian adapter

**Decision**: Define a minimal `FileStore` port (interface) — `read`, `write`, `delete`, `exists`, `list`, all scoped to a base folder and taking vault-relative paths — and inject it into the persistence core. Production wiring supplies an `ObsidianFileStore` backed by the Obsidian `Vault`/`DataAdapter` API; verification supplies an `InMemoryFileStore` fake. The core (record wrap/unwrap, note serialize/parse, filename, index, reconcile, store orchestration) imports **no** `obsidian` symbols.

**Rationale**: This feature is the plugin's first that performs real vault I/O, but almost all of its hard requirements are *logic* (field-scoped merge FR-004, tombstoned two-phase delete FR-021, JSON-authoritative reconciliation FR-013, injective filenames FR-007, the FR-015 read API). With no test runner in the repo (`CLAUDE.md`), the only way to verify that logic offline — via the `esbuild`+`node` `quickstart.md` pattern already established by 001 — is to keep it free of the Obsidian host. A thin port confines every side effect and the only Obsidian dependency to one adapter file, satisfying constitution Principle VI (single-responsibility, testable modules) and Principle IV (I/O confined and auditable).

**Alternatives considered**:
- *Call `this.app.vault` directly from the store*: rejected — makes the core untestable without an Obsidian host and spreads I/O across modules.
- *Node `fs` directly*: rejected — even though the project is now desktop-only (Node APIs permitted), the Vault API is the correct Obsidian-native surface (respects the vault abstraction, config-dir, and future mobile lineage) and keeps I/O auditable within the vault (Principle IV). `fs` would bypass all of that.

## 2. Note anatomy — three regions, HTML-comment-delimited managed body

**Decision**: A note is parsed into exactly three regions in order: **(1) YAML frontmatter** (`---` fenced at file top) holding the mirrored shared subset (`title`, `authors`, `publicationYear`, `citationCount`, `readState`, `pg3d_sourceId`); **(2) a managed body block** delimited by HTML comment markers `<!-- pg3d:begin -->` … `<!-- pg3d:end -->` holding rendered prose (abstract, or 004's summary + future-directions); **(3) the user's free-form body** — everything after the managed block. Writes rewrite regions (1) and (2) wholesale and never touch (3). Frontmatter is produced/parsed with Obsidian's `stringifyYaml`/`parseYaml`.

**Rationale**: The spec pins the managed region to "frontmatter + a delimited managed body block" (FR-002, FR-005). HTML comments are invisible in Obsidian's rendered preview, survive round-tripping, and give an unambiguous, easily-scannable boundary so the user's body start is never guessed. Using Obsidian's own YAML helpers keeps frontmatter compatible with Obsidian's metadata cache and avoids a bespoke/3rd-party YAML dependency.

**Alternatives considered**:
- *Frontmatter-only managed region*: rejected during clarify — 004's abstract/summary prose must be readable in the note body, not crammed into frontmatter.
- *A dedicated `## heading` section as the managed block*: rejected — a heading is user-meaningful content a user might edit/move; invisible comment markers are unambiguous and inert.
- *`FileManager.processFrontMatter`*: considered for frontmatter, but we rewrite the entire managed region (frontmatter **and** body block) as one unit and must split off the user body ourselves, so a single custom three-region serializer is simpler and fully testable offline.

## 3. Filename derivation — injective sanitization of `sourceId`

**Decision**: `fileStem(sourceId)` = `provider` prefix + `_` + sanitized local part, replacing only filesystem-illegal/reserved characters (`: \ / : * ? " < > |`, trailing dots/spaces, reserved device names) with `_`, e.g. `arxiv:2401.12345` → `arxiv_2401.12345`. Guarantee injectivity: maintain the `sourceId ↔ stem` mapping in the index; on the rare post-sanitization collision between two distinct `sourceId`s, append a short deterministic disambiguator (e.g. `-2`). The `.json` and `.md` share the stem. The filename is **not** authoritative — content-level `sourceId` (FR-009) is.

**Rationale**: Directly implements the FR-007 clarification. Sanitizing only illegal characters keeps names human-readable; the index-backed collision check makes injectivity a guarantee rather than a probability, without needing a reversible encoding.

**Alternatives considered**:
- *Hash the `sourceId` (e.g. base32 of a digest)*: rejected — collision-safe but unreadable, hurting the "user can browse their vault" experience.
- *Percent-encode the colon*: rejected — `%3A` is legal but ugly and still needs collision handling for other characters; the readable prefix form is friendlier.

## 4. Tombstone mechanism — per-paper marker file, two-phase

**Decision**: A delete writes a tiny per-paper tombstone marker file (`<stem>.pg3d-del`, content = `{ sourceId, at }`) **first**, then deletes the `.md`, then the `.json`, then the tombstone (four ordered steps). On load/next-touch, any paper (or orphan) carrying a tombstone has its delete **resumed and completed**. Create ordering is the mirror: write `.json` durably before `.md`. Tombstone files are non-paper files the pairing scan ignores (§7, FR-013/FR-023).

**Rationale**: Implements FR-021 exactly. A separate marker that outlives both record and note is what lets reconciliation distinguish a genuine orphan ("report, never delete") from a delete interrupted mid-flight ("resume the delete") — a record- or note-embedded flag cannot, because the delete removes those files. Per-paper markers keep the mechanism isolated per FR-014/FR-007.

**Alternatives considered**:
- *A central `pending-deletes.json`*: rejected — a shared mutable file reintroduces the cross-paper coupling and multi-writer contention that per-paper sidecars exist to avoid.
- *A `deleted: true` field in the record*: rejected — the record is deleted by the operation, so the marker must be external to survive.

## 5. In-memory index shape — lightweight, embedding vectors excluded

**Decision**: The index is `Map<sourceId, IndexEntry>` where `IndexEntry` holds only lightweight metadata: `sourceId`, `fileStem`, the mirrored subset (`title`, `authors`, `publicationYear`, `citationCount`, `readState`), `embeddingModel`, `embeddingPending: boolean`, `schemaVersion`, `createdAt`, `updatedAt`. It does **not** hold the embedding vector, `references`, `abstract`, `summary`, or `futureDirections`. FR-015 reads: (a) `has(sourceId)` → index membership; (b) single read-back to canonical `Paper` → read that paper's `.json` on demand (so the returned `Paper` includes the vector/references/abstract); (c) enumeration for 006 → iterate the index and read each `.json` on demand (streaming), hydrating embeddings only as 006 consumes them.

**Rationale**: Implements the 2026-07-08 clarification and SC-006. A resident vector per paper (hundreds–thousands of floats × ~1,000 papers) would blow the memory/scan budget; keeping vectors on disk and reading them on demand keeps the load scan to cheap metadata while still serving 006. Existence checks and read-state toggles (the hot paths for 002/005) never need the vector, so they stay in-memory-fast.

**Alternatives considered**:
- *Hold full records (incl. vectors) resident*: rejected — violates the SC-006 budget clarification.
- *A separate on-disk index file*: rejected for v1 — the load scan already meets ≤2 s for ~1,000 papers, and a derived index file adds its own consistency/staleness problem; it is a possible future optimization, not a requirement.

## 6. Record schema & migration — versioned wrapped superset, lazy embedding backfill

**Decision**: `PaperRecord = { schemaVersion, paper: Paper, createdAt, updatedAt, readState, summary?, futureDirections? }`. The embedding lives **inside** the serialized `paper` (it is a 001 core `Paper` field — `embedding`/`embeddingModel`/`embeddingSource`), not duplicated on the wrapper; FR-022's "the wrapper persists the embedding" is satisfied because the wrapper contains `paper`. `migrate(raw)` normalizes an older record: a `paper` missing the embedding fields gets them set to `null` (pending), `schemaVersion` is bumped, and no blocking pass runs — the pending vector is backfilled later by 002/005 re-embedding (FR-016/FR-021/2026-07-08 clarification).

**Rationale**: Resolves the minor wrapper-vs-`paper` wording: embedding is a `Paper` field (001), so it is naturally nested under `paper`; the wrapper adds only persistence/cross-feature metadata. Lazy pending normalization mirrors the established `citationsKnown` pattern, keeps load non-blocking (SC-006), and never invalidates a stored paper.

**Alternatives considered**:
- *Store the embedding as a top-level wrapper field beside `schemaVersion`*: rejected — it duplicates a 001 `Paper` field, risking two sources of truth for the same value on read-back into `Paper`.
- *Blocking migration that backfills all embeddings at load*: rejected by clarify — blocks the UI and re-does work 002/005 already own.

## 7. Reconciliation & scan scope — only `.json`+`.md` paper pairs

**Decision**: The load scan and reconciliation operate on `.json`+`.md` pairs keyed by content `sourceId` only. Every non-paper file — the projection-basis cache (FR-023), tombstone markers (§4), any stray plugin file — is explicitly ignored and never treated as an orphan or delete candidate. Reconciliation (FR-013): a record without a note → rebuild the note's managed region from the record; a note without a record and **no** tombstone → report to the user (never silently delete); a paper with a tombstone → resume/complete the delete (FR-021).

**Rationale**: Implements the 2026-07-08 clarification, preventing the real bug of mistaking the regenerable basis cache (a `.json`-ish file) for an orphan record. JSON-authoritative repair matches FR-002/FR-013.

## 8. Per-paper write serialization

**Decision**: Serialize writes per `sourceId` with an in-process async lock (a per-key promise chain / mutex map keyed by `sourceId`). Concurrent `upsert`/`delete` for the *same* paper queue behind one another; different papers proceed in parallel.

**Rationale**: Implements FR-014 (a collection persist, a 005 refresh, and a 007 delete for the same paper must not interleave into a partial state) without a global lock that would serialize unrelated papers and hurt the batch throughput 002 needs. Purely in-memory, no dependency.

**Alternatives considered**:
- *Global write lock*: rejected — needlessly serializes independent papers, hurting large-batch collection.
- *Rely on Obsidian atomic writes alone*: rejected — atomic single-file writes don't make the **two-file** pairing (record + note) coordinated; the app-level lock is what keeps the pair consistent.

## 9. OQ-4 — list-field rendering in frontmatter

**Decision**: `authors` renders as a YAML block sequence (one `- name` per line) via `stringifyYaml`. `references` is **not** in the frontmatter at all (it is excluded from the FR-002 mirrored subset and lives only in the JSON record), so no rendering decision is needed for it. This closes OQ-4.

**Rationale**: A block sequence is the readable, Obsidian-native way to show a multi-author list in frontmatter; excluding raw `references` sourceIds from the note keeps the human-facing surface clean and matches the fixed mirrored subset.

## 10. Verification strategy without a test framework

**Decision**: Follow 001's precedent. `quickstart.md` drives the persistence core against the `InMemoryFileStore` fake via `esbuild`+`node`, asserting each FR/SC behavior (create pairing, field-scoped merge preserving summary/embedding + untouched user body, dedup, tombstoned delete, orphan report vs resume, injective filenames, pending-embedding migration, embedding never in the note). The thin `ObsidianFileStore` adapter — the only Obsidian-touching code — is smoke-tested manually in a real vault. `tsc --noEmit` and `eslint .` remain the CI gates.

**Rationale**: Keeps zero new tooling/dependencies (constitution Development Workflow), exercises the load-bearing logic deterministically offline, and isolates the small untestable-offline surface (the Vault adapter) to a manual check.
