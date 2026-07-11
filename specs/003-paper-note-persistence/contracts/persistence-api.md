# Contract: `src/persistence/` exported API

The internal contract 002 (dedup/persist), 005 (refresh/read-back), 006 (graph enumeration), and 008 (lifecycle wiring) build against. Library-style TypeScript surface — no network/CLI interface. Additive changes (new optional fields, new methods) don't require editing existing entries; behavior-changing edits must update `spec.md`. The `Paper`/`PaperSourceId` types are imported from `src/models/paper.ts` (001) unchanged.

## `src/persistence/store.ts`

```ts
import type { Paper, PaperSourceId } from '../models/paper';

export type ReadState = 'unread' | 'read';

// What a caller hands in to persist. 002/005 supply the canonical Paper plus any
// cross-feature managed fields they own; omitted wrapper fields are preserved.
export interface PersistInput {
  paper: Paper;                 // 001 shape, incl. embedding fields
  summary?: string;             // 004-owned; omit to preserve existing
  futureDirections?: string;    // 004-owned; omit to preserve existing
  readState?: ReadState;        // omit to preserve existing (default 'unread' on create)
}

export interface PaperStore {
  // Build the in-memory index from the storage folder; resume any tombstoned
  // deletes and reconcile obvious inconsistencies lazily. Target <=2s / ~1000
  // papers, no embedding vectors loaded (FR-015/FR-017/SC-006).
  load(): Promise<void>;

  // Create-or-update the paired .json+.md as one coordinated, per-paper-serialized
  // operation; field-scoped merge preserves wrapper fields and a stored non-null
  // embedding (FR-003/FR-004/FR-014). Never duplicates a note (FR-008).
  upsert(input: PersistInput): Promise<void>;

  // FR-015(a): existence check by sourceId (002 cross-session dedup). Index-served.
  has(sourceId: PaperSourceId): boolean;

  // FR-015(b): read one stored record back into canonical Paper shape (005).
  // Reads the .json on demand so the returned Paper includes the embedding vector
  // and references. undefined if not stored.
  get(sourceId: PaperSourceId): Promise<Paper | undefined>;

  // FR-015(c): enumerate all stored papers for graph build (006). Async-iterates,
  // hydrating each record's embedding from disk on demand (not resident).
  all(): AsyncIterable<Paper>;

  // Coordinated tombstoned two-phase delete of the .json+.md pair, incl. the user
  // body (FR-012/FR-021). Caller (007) owns any body-loss confirmation.
  delete(sourceId: PaperSourceId): Promise<void>;

  // FR-018: called by 008 when the storage-folder setting changes. Leaves old
  // pairings untouched at the previous folder, re-points at the new folder's
  // FileStore and rebuilds the index, and notifies that previously stored papers
  // remain in the old location.
  onStorageFolderChanged(previousFolder: string, newFileStore: FileStore): Promise<void>;
}
```

**Behavior guarantees**:
- `load` never blocks the UI thread meaningfully; it reads lightweight metadata only (no embedding vectors) and completes within the SC-006 budget for ~1,000 papers. It resumes tombstoned deletes (FR-021) and ignores non-paper files — the projection-basis cache (FR-023) and tombstone markers (FR-013).
- `upsert` is coordinated (both files or neither, FR-003) and per-`sourceId` serialized (FR-014). Merge is field-scoped (FR-004): unset wrapper fields (`summary`/`futureDirections`/`readState`/`createdAt`) survive, and an incoming `paper.embedding === null` preserves a stored non-null vector (SC-007). The user's free-form note body is never touched (FR-005/SC-002).
- `get` returns the full canonical `Paper` (embedding vector + references included) by reading the record on demand; the mirrored subset it exposes always agrees with the note's managed region (FR-002).
- `all` yields every stored paper exactly once for 006; a single malformed/unreadable record is skipped (surfaced), never aborting the enumeration.
- `delete` removes both files and the user body; an interruption leaves a tombstone that a later `load`/touch completes (FR-021). Nothing outside the designated folder is ever touched (FR-006/SC-004).
- Every method confines all I/O to the designated storage folder (FR-006). No network or external calls occur (constitution IV).

## `src/persistence/filestore.ts`

```ts
export interface FileStore {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(): Promise<string[]>;
}

export class InMemoryFileStore implements FileStore { /* verification fake */ }
// In src/persistence/filestore-obsidian.ts (the only Obsidian-touching module):
export function createObsidianFileStore(app: App, baseFolder: string): FileStore; // production
```

**Behavior guarantees**:
- All `path` arguments are resolved relative to `baseFolder`; a `FileStore` MUST NOT read or write outside it (FR-006). `list()` returns only entries inside the base folder.
- `read` returns `null` for an absent file (never throws for absence); callers use this to detect orphans (FR-013).

## `src/persistence/record.ts` (supporting)

```ts
export interface PaperRecord {
  schemaVersion: number;
  paper: Paper;                       // 001, incl. embedding fields
  createdAt: number;
  updatedAt: number;
  readState: ReadState;
  summary?: string;
  futureDirections?: string;
}

export function wrap(input: PersistInput, prev?: PaperRecord): PaperRecord; // field-scoped merge
export function unwrap(record: PaperRecord): Paper;
export function migrate(raw: unknown): PaperRecord; // pending-embedding normalization, no blocking pass
```

**Behavior guarantees**:
- `wrap` with a `prev` performs the field-scoped merge (FR-004/SC-007), including the embedding preserve-unless-supplied rule; without `prev` it creates (`createdAt = updatedAt = now`, `readState = input.readState ?? 'unread'`).
- `migrate` normalizes a record missing embedding fields to pending (`null`) and bumps `schemaVersion`; it never rejects for a missing embedding (FR-016/FR-021).

## `src/persistence/note.ts` & `filename.ts` (supporting)

```ts
export function renderNote(record: PaperRecord, previousUserBody: string): string;
export function parseNote(text: string): { frontmatter: Record<string, unknown>; managedBody: string; userBody: string };
export function noteStem(paper: Pick<Paper, 'title' | 'sourceId' | 'publicationYear' | 'publicationDate'>, taken: ReadonlySet<string>): string; // "<YYYY>/<MM>/<title (id)>", injective (FR-007)
export function publicationDir(paper: Pick<Paper, 'publicationYear' | 'publicationDate'>): string; // "<YYYY>/<MM>" (month 'unknown' when year-only)
export function fileStem(sourceId: PaperSourceId, taken: ReadonlySet<string>): string; // sourceId-based fallback, injective
```

**Behavior guarantees**:
- `renderNote` writes only the frontmatter (mirrored subset) + managed body block; `previousUserBody` is appended verbatim (FR-005). The embedding never appears in any region (FR-022/SC-008).
- `parseNote` splits a note into the three regions without parsing the user body as state (FR-009/FR-010).
- `noteStem` (used by `store.createPath`) derives a human-readable **relative stem** `<YYYY>/<MM>/<title (id)>` — the `publicationDir` date folder plus the title-based name (normalized/sanitized/length-capped + provider-local id in parentheses, e.g. `2024/03/Attention Is All You Need (2401.12345)`), so it is injective (the id suffix differs per paper) and rename-safe (FR-007/FR-009). The title part falls back to `fileStem`'s sanitization when the title is empty; `publicationDir` uses month `unknown` when only a year is known. `store.load` recurses through the date subfolders (via the FileStore's recursive `list()`), and writes create parent folders as needed.
- `fileStem` is the sourceId-based fallback stem: injective given the set of already-`taken` stems, appending a deterministic disambiguator when two distinct `sourceId`s sanitize alike.
