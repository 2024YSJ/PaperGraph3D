# Phase 1 Data Model: Paper Note Persistence

Source: `spec.md` (Key Entities, Functional Requirements, Clarifications) and `research.md`. Types below are the concrete TypeScript design; see `contracts/persistence-api.md` for the exported surface. The logical `Paper` shape is owned by 001 (`src/models/paper.ts`) and reused unchanged — this feature adds only the persistence wrapper, note-region, index, and port types.

## PaperRecord (JSON record — the wrapped superset)

`src/persistence/record.ts`

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | `number` | FR-016. Present on every record; incremented when the record shape changes (e.g., the embedding-fields addition) so future reads can migrate. |
| `paper` | `Paper` (001) | The serialized canonical paper — includes 001's core fields **and** `embedding`/`embeddingModel`/`embeddingSource` (FR-022 is satisfied via this nesting; the embedding is *not* duplicated on the wrapper). |
| `createdAt` | `number` (epoch ms) | FR-020. Set once on create; preserved across every update. |
| `updatedAt` | `number` (epoch ms) | FR-020. Set to now on create and on every persisted update. |
| `readState` | `ReadState` (`'unread' \| 'read'`) | FR-020. Defaults to `'unread'` on create. Toggle UI is not owned here. |
| `summary` | `string \| undefined` | Reserved slot owned/populated by 004; preserved by field-scoped merge (FR-004). |
| `futureDirections` | `string \| undefined` | Reserved slot owned/populated by 004; preserved by field-scoped merge (FR-004). |

**Serialization**: `wrap(input: PersistInput, prev?: PaperRecord): PaperRecord` builds/merges a record (field-scoped, FR-004); `unwrap(record): Paper` returns the nested `Paper`. Stored one `.json` per paper (FR-007).

**Migration**: `migrate(raw: unknown): PaperRecord` — normalizes an older/foreign record: if `paper` lacks the embedding fields, set `embedding`/`embeddingModel`/`embeddingSource` to `null` (pending) and bump `schemaVersion`; never rejects a record for a missing embedding (FR-016/FR-021, Clarification 2026-07-08). Returns a valid current-version record or throws only on structurally unusable input (handled per FR-013).

**Field-scoped merge** (FR-004, SC-007): an update overwrites only the `paper` fields and `updatedAt` it carries, and preserves every wrapper field it does not set (`summary`, `futureDirections`, `readState`, `createdAt`). The embedding follows a **preserve-unless-supplied** rule: an incoming `paper.embedding === null` (pending) MUST NOT overwrite a stored non-null vector — only a non-null incoming embedding replaces it (Clarification 2026-07-08).

## PaperNote (Markdown note — three regions)

`src/persistence/note.ts`

| Region | Content | Rule |
|---|---|---|
| Frontmatter (managed) | YAML mirroring the shared subset: `title`, `authors` (block sequence), `publicationYear`, `citationCount`, `readState`, `pg3d_sourceId`, `url` (derived from `sourceId`; omitted for an unrecognized provider), plus `publicationDate` (when known) and `references` (three-state, keyed on `citationsKnown`) | FR-002. Rewritten wholesale on merge; `schemaVersion`/timestamps/embedding are **not** here, and `url` is derived rather than stored in the JSON record. |
| Managed body block (managed) | Delimited `<!-- pg3d:begin -->` … `<!-- pg3d:end -->`; rendered prose: `abstract`, replaced by `summary` when 004 is on, plus `futureDirections` when applicable | FR-002. Rewritten wholesale on merge. |
| User body (free-form) | Everything after the managed block | FR-005. **Never** modified, deleted, or parsed on update (delete removes it — FR-012). |

**Serialization**: `renderNote(record, prevUserBody): string` (managed regions from the record + the preserved user body); `parseNote(text): { frontmatter, managedBody, userBody }` (splitter). `pg3d_sourceId` in frontmatter is the content-level id used for rename-safe pairing (FR-009); the `url` line is derived from that same `sourceId` at render time (not stored). The embedding is never written to any region (FR-022, SC-008).

## IndexEntry (in-memory record index)

`src/persistence/index.ts` — `Map<PaperSourceId, IndexEntry>`, built at load, kept in sync on every write.

| Field | Type | Note |
|---|---|---|
| `sourceId` | `PaperSourceId` | Key. |
| `fileStem` | `string` | Relative stem shared by the `.json`/`.md` pair — the human-readable `<YYYY>/<MM>/<DD>/<title (id)>` (`noteStem`), or the sourceId-sanitized fallback under the date folder for an untitled paper (FR-007). |
| `title`, `authors`, `publicationYear`, `citationCount`, `readState` | mirrored subset | Serve fast reads without disk. |
| `embeddingModel` | `string \| null` | Lightweight provenance. |
| `embeddingPending` | `boolean` | `true` when the stored embedding is `null`. |
| `schemaVersion`, `createdAt`, `updatedAt` | metadata | Bookkeeping. |

**Excluded on purpose** (Clarification 2026-07-08, SC-006): the embedding **vector**, `references`, `abstract`, `summary`, `futureDirections` — read from the `.json` on demand. The index is a cache of authoritative on-disk records, not a second source of truth.

## Tombstone

`src/persistence/reconcile.ts` — a per-paper marker file `<fileStem>.pg3d-del` (`{ sourceId, at }`) written first in a delete and removed last (FR-021, research §4). Ignored by the pairing scan.

## FileStore (port)

`src/persistence/filestore.ts`

```ts
interface FileStore {
  read(path: string): Promise<string | null>;   // null if absent
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(): Promise<string[]>;                     // vault-relative paths inside the base folder
}
```

Two implementations: `ObsidianFileStore` (Vault API, production) and `InMemoryFileStore` (fake, for `quickstart.md`). All paths are within the designated storage folder (FR-006).

## Relationships & invariants

- One `Paper` (001) ⇄ one `PaperRecord` ⇄ one `.json`+`.md` pair, keyed by `sourceId`.
- **Pairing invariant** (FR-003/SC-005): after any completed op, neither file exists without the other, and the mirrored subset agrees; violations are reconciled JSON-authoritatively on next touch (FR-013).
- **Boundary invariant** (FR-006/SC-004): every path acted on is inside the designated folder.
- **User-content invariant** (FR-005/SC-002): the user body is byte-for-byte unchanged across updates.
- The projection-basis cache (006/FR-023) and tombstone markers are plugin files inside the folder that are **not** paper pairs and are excluded from pairing/reconciliation scans.
