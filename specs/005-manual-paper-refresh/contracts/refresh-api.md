# Contract: Manual Paper Refresh (`src/refresh/`)

This feature exposes two entry points that 008 wires to commands/menu items (spec Assumptions — this feature owns behavior, not trigger placement) and consumes 002's provider/embedding functions + 003's `PaperStore` as injected dependencies or direct imports of their existing public exports — never by reimplementing their internals.

## `src/refresh/types.ts`

```ts
import type { Paper, PaperSourceId } from '../models/paper';
import type { SummarizationInput, SummaryResult } from '../collection/types';
import type { EmbeddingConfig } from '../collection/embeddingUpgrade';

export type RefreshOutcome =
  | { status: 'updated' }
  | { status: 'notFound' } // paper absent at arXiv, OR sourceId not present in the store at all (checked before any provider call)
  | { status: 'alreadyInFlight' }
  | { status: 'error'; message: string }; // arXiv content call failed — a Semantic Scholar-only failure does NOT produce this; see refreshOne below

export interface RefreshHooks {
  // Narrow 004 contract, reused verbatim (FR-017, research.md Decision 6).
  summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>;
}

export interface BulkRefreshResult {
  matchedCount: number;
  failures: { sourceId: PaperSourceId; reason: string }[];
}

export type { EmbeddingConfig } from '../collection/embeddingUpgrade';
```

## `src/refresh/concurrencyGuard.ts`

```ts
// One shared instance per plugin session (owned by 008's wiring, injected into both
// refreshOne and runBulkRefresh calls).
export interface ConcurrencyGuard {
  claimSingle(sourceId: PaperSourceId): boolean;   // false if already claimed by single or bulk
  releaseSingle(sourceId: PaperSourceId): void;
  claimBulk(): boolean;                             // false if a bulk run is already active
  releaseBulk(): void;                              // also clears any pending cancel request (research.md Decision 12)
  claimForBulkItem(sourceId: PaperSourceId): boolean; // false if a concurrent single refresh holds it
  releaseForBulkItem(sourceId: PaperSourceId): void;
  requestBulkCancel(): void;                        // FR-022 — no-op if no bulk run is active
  isBulkCancelRequested(): boolean;                 // checked by runBulkRefresh between papers
}

export function createConcurrencyGuard(): ConcurrencyGuard;
```

FR-006/FR-012: `claimSingle`/`claimForBulkItem` share the same underlying in-flight `Set`, so a single-paper claim and a bulk-item claim on the same sourceId can never both succeed.

## `src/collection/arxivClient.ts` (extended — new exports, existing module)

```ts
// NEW for 005. Single-ID direct lookup (`id_list=`), no window/paging — returns the one
// matching Atom <entry>, or undefined if arXiv has none (FR-005's "no longer found").
// research.md Decision 1.
export async function fetchArxivEntryById(baseArxivId: string): Promise<Element | undefined>;

// NEW for 005, corrected 2026-07-11 (research.md Decision 4). Bulk-refresh content
// lookup: `id_list=` accepts a comma-separated batch (verified live), chunked to
// ARXIV_PAGE_SIZE ids/request and paced at ARXIV_INTER_PAGE_DELAY_MS between chunks —
// the same pattern queryArxiv already uses for paged discovery. `found` maps each
// requested id that arXiv still has to its <entry>; an id absent from `found` (and not
// in `failedIds`) means arXiv has no record (FR-005's "no longer found", batched form).
// A chunk whose HTTP call itself throws (throttled/malformed) puts every one of that
// chunk's ids into `failedIds` instead of retrying them individually.
export async function fetchArxivEntriesByIds(
  baseArxivIds: string[],
): Promise<{ found: Map<string, Element>; failedIds: Set<string> }>;
```

## `src/refresh/embeddingRecompute.ts`

```ts
import type { EmbeddingConfig } from '../collection/embeddingUpgrade';
import type { EmbeddingResult } from '../collection/embedding';

// FR-019, research.md Decision 9. Composes 002's two already-exported functions —
// never reimplements embedding math, never reaches into reembed.ts's private helper.
export async function computeCanonicalEmbedding(
  title: string,
  abstract: string,
  config: EmbeddingConfig,
): Promise<EmbeddingResult>;
// Implementation:
//   if (config.provider === 'bundled') return computeBaselineEmbedding(title, abstract);
//   const upgraded = await upgradeEmbedding(title, abstract, config);
//   return upgraded ?? computeBaselineEmbedding(title, abstract);
```

## `src/refresh/refreshOne.ts`

```ts
import type { PaperStore } from '../persistence/store';
import type { PaperSourceId } from '../models/paper';
import type { ConcurrencyGuard } from './concurrencyGuard';
import type { RefreshHooks, RefreshOutcome, EmbeddingConfig } from './types';

// Single-paper refresh (FR-001–FR-006, FR-013, FR-014, FR-017, FR-019, FR-020, FR-021).
// Also the per-paper unit bulkRefresh.ts calls for each matched paper.
//
// Steps: 0) store.get(sourceId); undefined => 'notFound' immediately, no provider call
// (FR-021's store-absent case) 1) guard.claimSingle (or the caller has already claimed via
// claimForBulkItem — see `alreadyClaimed` param) 2) fetchArxivEntryById -> parseArxivEntry-
// equivalent; not found => 'notFound', release, return 3) fetchSemanticScholarPaper for
// citation data (single mode only — bulk supplies pre-fetched citation data via
// `citationOverride`); a failure/no-record here does NOT abort (FR-021's independent-
// failure rule) — citationCount/references/citationsKnown are carried through from the
// previously-stored Paper unchanged 4) build the updated Paper
// (title/abstract/authors always overwritten per FR-013; citationCount/references/
// citationsKnown updated only when citation data was actually obtained this call;
// publicationYear and sourceId are NEVER taken from the re-fetched entry — the
// stored publicationYear is carried through unchanged, FR-002, as the FR-009 window
// key, and an unparseable re-fetched year does not invalidate the refresh)
// 5) compare fresh vs. stored title/abstract; if changed, call computeCanonicalEmbedding
// (getEmbeddingConfig() read live) and apply its embedding/embeddingModel/embeddingSource
// onto the Paper, else leave the paper's previous embedding fields as-is (FR-019)
// 6) summaryTrigger.shouldRegenerateSummary(previouslyStored, { abstract,
// citationCount, citationsKnown }) using the EFFECTIVE post-refresh citation
// values — the fetched values when Semantic Scholar supplied data this call, else
// the carried-through stored values (FR-021), so an unavailable lookup never reads
// as an uncited-status change; "uncited" = citationsKnown && count === 0 (FR-020)
// 7) if triggered AND summarization enabled (read live) -> hooks.summarize, discard on
// mid-flight disable (FR-014) 8) store.upsert(...) 9) release guard 10) return 'updated'.
export async function refreshOne(
  store: PaperStore,
  sourceId: PaperSourceId,
  guard: ConcurrencyGuard,
  hooks: RefreshHooks,
  isSummarizationEnabled: () => boolean,
  getSemanticScholarApiKey: () => string | undefined,
  getEmbeddingConfig: () => EmbeddingConfig, // live read (research.md Decision 9) — PluginSettings.embeddingProvider ?? 'bundled' + localEmbeddingModel
  options?: {
    alreadyClaimed?: boolean;               // true when called from bulkRefresh, which claimed via claimForBulkItem
    citationOverride?: { citationCount: number; references: PaperSourceId[] } | 'unavailable'; // bulk's pre-fetched batch result for this paper
    // NEW, corrected 2026-07-11: bulk's pre-fetched fetchArxivEntriesByIds result for this
    // paper. When present, refreshOne skips its own fetchArxivEntryById call entirely —
    // 'notFound' mirrors an absent single lookup, 'error' surfaces a failed batch chunk
    // for this paper without a per-paper retry (research.md Decision 4).
    contentOverride?: { status: 'found'; entry: Element } | { status: 'notFound' } | { status: 'error'; message: string };
  },
): Promise<RefreshOutcome>;
```

## `src/refresh/bulkRefresh.ts`

```ts
import type { PaperStore } from '../persistence/store';
import type { ConcurrencyGuard } from './concurrencyGuard';
import type { RefreshHooks, BulkRefreshResult, EmbeddingConfig } from './types';

// Bulk refresh (FR-009–FR-012, FR-015, FR-016, FR-018, FR-018b, FR-019, FR-022).
// Enumerates store.all() (research.md Decision 10) and selects every Paper with
// publicationYear >= currentYear - 1 (year-granularity comparison, FR-009, research.md
// Decision 11). If the matched set exceeds BULK_LARGE_RUN_THRESHOLD and confirmLargeRun
// is supplied, awaits it before any provider call — a false resolution returns
// 'declinedLargeRun' with the store untouched (FR-018b). Otherwise: batch-looks-up
// citation data through fetchSemanticScholarBatch ONCE (FR-018), batch-looks-up arXiv
// content through fetchArxivEntriesByIds ONCE (FR-015, corrected — research.md Decision
// 4), then calls refreshOne sequentially per paper (each with its citationOverride AND
// contentOverride from the two batch results, plus the same hooks/getEmbeddingConfig
// passed through) — every iteration is now pure local work (no per-paper network call),
// reporting via onProgress, and never aborting on one paper's failure (FR-011). Between
// each paper's refreshOne call settling and the next one starting, checks
// guard.isBulkCancelRequested() (FR-022, research.md Decision 12) — a true reading stops
// the loop right there, returning matchedCount/failures for whatever was actually
// processed, and guard.releaseBulk() runs exactly as it would on normal completion.
export async function runBulkRefresh(
  store: PaperStore,
  guard: ConcurrencyGuard,
  hooks: RefreshHooks,
  isSummarizationEnabled: () => boolean,
  getSemanticScholarApiKey: () => string | undefined,
  getEmbeddingConfig: () => EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
  // NEW, added 2026-07-11 (FR-018b). Asked once, before any provider call, only when the
  // matched set exceeds BULK_LARGE_RUN_THRESHOLD (300). Absent (008 not yet wired) or
  // resolving true proceeds unconditionally, preserving prior behavior.
  confirmLargeRun?: (matchedCount: number) => Promise<boolean>,
): Promise<BulkRefreshResult | { status: 'alreadyRunning' } | { status: 'declinedLargeRun' }>;
```

## `src/refresh/summaryTrigger.ts`

```ts
import type { Paper } from '../models/paper';

// Pure predicate — FR-014 ∨ FR-020 (research.md Decision 5).
// `fresh` carries the EFFECTIVE post-refresh citation state (refreshOne step 6):
// fetched values on a Semantic Scholar success, else the carried-through stored
// values (FR-021) — so an unavailable lookup never reads as a status change.
// isUncited(p) := p.citationsKnown === true && p.citationCount === 0  // confirmed zero, 001/002 FR-018
// returns: fresh.abstract !== stored.abstract
//       || isUncited(stored) !== isUncited(fresh)
export function shouldRegenerateSummary(
  stored: Paper,
  fresh: { abstract: string; citationCount: number; citationsKnown: boolean },
): boolean;
```

## Dependencies this feature consumes (no new 002/003 exports needed beyond `fetchArxivEntryById`/`fetchArxivEntriesByIds`)

- `src/collection/arxivClient.ts`: `fetchArxivEntryById` (new), `fetchArxivEntriesByIds` (new, corrected 2026-07-11), both reusing the module's shared Atom-parsing guard (`parseArxivEntries`, which also now backs `queryArxiv`'s own paging).
- `src/collection/arxivParser.ts`: `parseArxivEntry` (single-entry mapping, reused as-is against the one `<entry>` `fetchArxivEntryById` returns).
- `src/collection/semanticScholarClient.ts`: `fetchSemanticScholarPaper` (single-paper mode), `fetchSemanticScholarBatch` (bulk mode) — both already exist, unchanged.
- `src/collection/semanticScholarParser.ts`: `parseSemanticScholarPaper`, `toPaperSourceId` — unchanged.
- `src/collection/types.ts`: `SummarizationInput`, `SummaryResult` — unchanged, imported not redefined (FR-017).
- `src/collection/embedding.ts`: `computeBaselineEmbedding`, `EmbeddingResult` — already exported (002 FR-044), unchanged.
- `src/collection/embeddingUpgrade.ts`: `upgradeEmbedding`, `EmbeddingConfig` — already exported (002 FR-045/046), unchanged.
- `src/models/settings.ts`: `EmbeddingProvider`, `PluginSettings.embeddingProvider`/`localEmbeddingModel` — already exist (001 FR-022), read live by `getEmbeddingConfig`'s implementation (008's wiring concern, not this feature's).
- `src/persistence/store.ts`: `PaperStore.get`, `PaperStore.all`, `PaperStore.upsert` — unchanged (FR-003, research.md Decisions 7/10).
- `src/models/paper.ts`: `Paper`, `PaperSourceId` — unchanged.

**NOT consumed**: `src/collection/reembed.ts`'s `reembedCorpus`/`computeCanonical` — deliberately not reused (research.md Decision 9's Alternatives).
