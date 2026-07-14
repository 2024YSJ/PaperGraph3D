# Quickstart: Validating Paper Note Persistence

Purpose: prove the `src/persistence/` core behaves as `spec.md`'s acceptance scenarios and success criteria require, **without** a test framework and **without** a live Obsidian host — by driving the `PaperStore` against the `InMemoryFileStore` fake (see `contracts/persistence-api.md`). The thin `ObsidianFileStore` adapter is verified separately by the manual in-vault smoke at the end.

## Prerequisites

- `npm install` has been run (esbuild devDependency present).
- `src/persistence/*.ts` exist and `npm run build` passes (`tsc --noEmit` clean).
- The 001 models (`src/models/paper.ts`) are present (reused for the `Paper` shape).

## Setup

Create a scratch file (not committed), e.g. `scratch/verify-persistence.ts`, that constructs a `PaperStore` over an `InMemoryFileStore` and asserts the scenarios below. Reference `contracts/persistence-api.md` for the exact signatures; keep helpers minimal:

```ts
import { InMemoryFileStore } from '../src/persistence/filestore';
// ...construct the store over the fake, per contracts/persistence-api.md...

function check(label: string, ok: boolean) { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); }
```

## Run

```bash
npx esbuild scratch/verify-persistence.ts --bundle --platform=node --outfile=scratch/verify-persistence.js
node scratch/verify-persistence.js
rm -rf scratch
```

## Scenarios to assert (maps to `spec.md`)

### Create & mirror (US1)

- **Create pairing** (FR-001/SC-001): `upsert` a new paper → the fake holds exactly one `.json` and one `.md` sharing the stem; no other files.
- **Frontmatter mirrors subset** (FR-002): the `.md` frontmatter contains `title`, `authors` (block sequence), `publicationYear`, `citationCount`, `readState`, `pg3d_sourceId`, and a `url` derived from `sourceId` (e.g. `arxiv:2301.12345` → `https://arxiv.org/abs/2301.12345`; omitted for an unrecognized provider) — and **not** `schemaVersion`/timestamps/embedding, nor a stored `url` in the `.json`.
- **Embedding never in the note** (FR-022/SC-008): neither the frontmatter, the managed body block, nor the user body contains the embedding vector; the `.json` record's `paper` does.
- **Atomic create** (US1.3/FR-011): a `write` failure injected on the `.md` leaves **neither** file (record written durably first, then rolled back on detected failure).

### Merge without destroying user writing (US2)

- **User body preserved** (FR-005/SC-002): append hand-written text to the note's user body, `upsert` an updated paper → managed regions change, user body byte-for-byte unchanged.
- **Field-scoped merge preserves cross-feature fields** (FR-004/SC-007): a record with a `summary` (004) then a collection `upsert` that omits `summary` → `summary` survives.
- **Pending embedding does not clobber** (FR-004/SC-007): store a non-null embedding, then `upsert` a `Paper` whose `embedding` is `null` (a 005-style citation-only refresh) → the stored vector is preserved; a non-null incoming embedding *does* replace it.
- **No duplicate on re-persist** (FR-008/SC-003): `upsert` the same `sourceId` twice → still exactly one pairing.
- **Managed field edited by hand is rebuilt** (FR-010): hand-edit a frontmatter value, `upsert` → managed region rebuilt from the record; user body untouched.

### Folder boundary & delete (US3)

- **Stays in folder** (FR-006/SC-004): across create/update/delete, every path the fake sees is inside the base folder.
- **Coordinated delete** (FR-012): `delete` removes both `.json` and `.md` (incl. user body).
- **Tombstoned resume** (FR-021): simulate an interruption after the tombstone + `.md` removal (record still present) → next `load` completes the delete; a paper is not stranded.

### Read/query API (FR-015)

- **has()** (a): `has(sourceId)` true for stored, false otherwise (index-served).
- **get() read-back** (b): `get(sourceId)` returns a canonical `Paper` incl. the embedding vector and `references` (read on demand); `undefined` when absent.
- **all() enumeration** (c): `all()` yields each stored paper once; a deliberately corrupted single `.json` is skipped, not fatal.
- **Embedding not resident** (SC-006): after `load`, the index entries expose only lightweight metadata (`embeddingModel`, `embeddingPending`) — the vector is fetched only via `get`/`all`.

### Reconciliation & migration (FR-013/FR-016)

- **Orphan record → note rebuilt** (FR-013): place a `.json` with no `.md`, touch it → the note's managed region is rebuilt from the record.
- **Orphan note (no tombstone) → reported** (FR-013): a `.md` with no `.json` and no tombstone → reported, never silently deleted.
- **Basis cache ignored** (FR-023): drop a projection-basis cache file into the folder → the scan/reconcile ignores it (not treated as an orphan).
- **Pending-embedding migration** (FR-016): load a record whose `paper` lacks embedding fields → it loads with `embedding`/`embeddingModel`/`embeddingSource` = `null` (pending), `schemaVersion` bumped, never rejected.

### Filenames (FR-007)

- **Date-foldered, title-based, injective stem (FR-007)**: a titled paper → stem `<YYYY>/<MM>/<DD>/<title> (<provider-local id>)`, e.g. `2024/03/15/Attention Is All You Need (2401.12345)` (falls back to `<YYYY>/unknown` when only a year is known); an untitled paper falls back to the sourceId sanitization `arxiv:2401.12345` → `arxiv_2401.12345` under its date folder. The parenthesized id keeps distinct papers injective even at an identical title (disambiguator appended on any residual clash); `store.load` recurses through the date subfolders.

## Expected outcome

All `PASS` lines, zero `FAIL`. Delete `scratch/` afterward.

## Manual in-vault smoke (adapter only)

Because `ObsidianFileStore` is the sole Obsidian-touching code, verify it once by hand: in a scratch vault, wire the store to a test folder (via 008 or a temporary command), create/update/delete a paper, and confirm the `.json`/`.md` pair appears, a hand-typed body survives an update, and nothing outside the folder changes.
