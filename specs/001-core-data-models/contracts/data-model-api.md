# Contract: `src/models/` exported API

This is the internal contract every later feature builds against (spec `SC-001`). It is a library-style contract — TypeScript types and pure function signatures exported from `src/models/*.ts` — not a network/CLI interface, since this feature has no such surface. No signature listed here should change without also updating `spec.md`; additive exports (new fields via FR-016, new functions) don't need to change this contract's existing entries, only add to them.

## `src/models/subscription.ts`

```ts
export type SubscriptionType = 'keyword' | 'author' | 'arxivCategory';

export type CheckIntervalHours = 6 | 12 | 24 | 48 | 72;

export const ALLOWED_CHECK_INTERVALS_HOURS: readonly CheckIntervalHours[];

export const DEFAULT_CHECK_INTERVAL_HOURS: CheckIntervalHours; // 24

export interface Subscription {
  type: SubscriptionType;
  value: string;
  label: string;
  checkIntervalHours: CheckIntervalHours;
  lastCheckedAt: number | null;
  enabled: boolean;
}

export function isValidSubscription(data: unknown): data is Subscription;

export function assignCheckInterval(
  current: CheckIntervalHours,
  requested: number,
): CheckIntervalHours;
```

**Behavior guarantees**:
- `isValidSubscription` returns `false` for any input missing a field, with the wrong type for a field, or with `checkIntervalHours` not in `ALLOWED_CHECK_INTERVALS_HOURS` — never throws.
- `assignCheckInterval` never returns a value outside `ALLOWED_CHECK_INTERVALS_HOURS`; passing a `requested` value outside the list returns `current` unchanged.

## `src/models/paper.ts`

```ts
export type SourceProvider = 'arxiv' | 'semanticScholar';

export type PaperSourceId = `${SourceProvider}:${string}`;

export interface PaperCandidate {
  title: string;
  publicationYear: number | undefined;
  authors: string[];
  citationCount: number | undefined; // undefined = "not known yet", distinct from confirmed 0
  abstract: string;
  sourceId: PaperSourceId;
  references: PaperSourceId[] | undefined; // FR-016 extension; undefined = not fetched yet (see below)
  embedding: number[] | undefined;              // FR-019; undefined = not yet computed at collection time
  embeddingModel: string | undefined;           // FR-020; model id + version
  embeddingSource: 'local' | 'llm' | undefined; // FR-020; provenance of the vector
}

export interface Paper {
  title: string;
  publicationYear: number;
  authors: string[];
  citationCount: number;
  citationsKnown: boolean; // FR-018; see Behavior guarantees below
  abstract: string;
  sourceId: PaperSourceId;
  references: PaperSourceId[]; // FR-016 extension; outbound citations (see below)
  embedding: number[] | null;              // FR-019 core; null = pending, never a hold-back trigger
  embeddingModel: string | null;           // FR-020; null = pending
  embeddingSource: 'local' | 'llm' | null; // FR-020; null = pending
}

export function isPaperSourceId(value: string): value is PaperSourceId;

export function toPaper(candidate: PaperCandidate): Paper | undefined;

export function isValidPaper(data: unknown): data is Paper;
```

**Behavior guarantees**:
- `toPaper` returns `undefined` if and only if `candidate.publicationYear` is `undefined` **or** non-finite (`NaN`/`Infinity`) — the "hold back" rule, and publication year is the **only** hold-back trigger (FR-018). It never throws, and never returns a `Paper` with a missing or non-finite year.
- `toPaper` never holds a paper back for missing citation data: it sets `citationCount: candidate.citationCount ?? 0`, `references: candidate.references ?? []`, and `citationsKnown: candidate.citationCount !== undefined` — so a candidate whose citation data was never fetched is still promoted, with `citationsKnown = false` recording that its `citationCount: 0` is unconfirmed rather than a real zero.
- `isValidPaper` returns `false` for any input missing a field, with the wrong type for a field, with a non-finite/missing `publicationYear`, with a negative or non-finite `citationCount`, or with a non-boolean `citationsKnown` — never throws. `references` must be an array in which every element is a valid `PaperSourceId` (an empty array is valid).
- `references` is an **FR-016 additive extension** to the 001 baseline, fixed here so the downstream collection/note-saving/graph-conversion features (`260702-002`/`003`/`006`) share one definition. It holds the sourceIds of the papers this paper *cites* (outbound only); `citedBy` is never stored — the graph feature derives it by inverting `references`. Populating `references` is those later features' responsibility; this contract only fixes its shape and validation.
- `citationsKnown` (FR-018) is `true` only when `citationCount`/`references` came from a citation-aware provider; consumers that branch on citation status (`260702-004` future-directions text, `260702-007` uncited-node styling) MUST check `citationsKnown` together with `citationCount` — a `citationCount === 0` with `citationsKnown === false` is "unknown," not "confirmed uncited." Correcting a `false` flag later (re-enrichment, or manual refresh `260702-005`) is out of scope for this contract.
- `embedding` (FR-019, a core field) is L2-normalized over title + abstract and is **never a hold-back trigger** (FR-021): `toPaper` carries `embedding`/`embeddingModel`/`embeddingSource` through, defaulting any `undefined` to `null` (pending). `isValidPaper` accepts a `null` (pending) embedding but requires the keys present — `embedding` must be `null` or an array of finite numbers, `embeddingModel` must be `null` or a string, and `embeddingSource` must be `null`/`'local'`/`'llm'`. Only papers sharing one `embeddingModel` space may be jointly projected (`260702-006`); switching providers requires re-embedding. The local baseline is computed by `260702-002`; an optional LLM embedding by `260702-004`. Populating the vector is those features' responsibility; this contract fixes only its shape and validation.
- Two `Paper`/`PaperCandidate` values with equal `sourceId` MUST be treated as the same paper; the inverse (different `sourceId` ⇒ different paper) is guaranteed only within a single provider, not across providers.

## `src/models/settings.ts`

```ts
export interface GraphDisplayOptions {
  layout: string; // placeholder default, e.g. 'force-directed'
  colorScheme: string; // placeholder default, e.g. 'byPublicationYear'
}

export interface PluginSettings {
  storageLocation: string;
  summarizationEnabled: boolean;
  graphDisplayOptions: GraphDisplayOptions;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings;

export function isValidPluginSettings(data: unknown): data is PluginSettings;
```

**Behavior guarantees**:
- `DEFAULT_PLUGIN_SETTINGS.storageLocation` is a non-empty string.
- `DEFAULT_PLUGIN_SETTINGS.summarizationEnabled === false`.
- `isValidPluginSettings(DEFAULT_PLUGIN_SETTINGS) === true` always (the default must itself be valid).
