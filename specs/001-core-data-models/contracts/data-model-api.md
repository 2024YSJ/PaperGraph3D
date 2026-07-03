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
  citationCount: number;
  abstract: string;
  sourceId: PaperSourceId;
  references: PaperSourceId[]; // FR-016 extension; outbound citations (see below)
}

export interface Paper {
  title: string;
  publicationYear: number;
  authors: string[];
  citationCount: number;
  abstract: string;
  sourceId: PaperSourceId;
  references: PaperSourceId[]; // FR-016 extension; outbound citations (see below)
}

export function isPaperSourceId(value: string): value is PaperSourceId;

export function toPaper(candidate: PaperCandidate): Paper | undefined;

export function isValidPaper(data: unknown): data is Paper;
```

**Behavior guarantees**:
- `toPaper` returns `undefined` if and only if `candidate.publicationYear` is `undefined` (the "hold back" rule) — it never throws, and never returns a `Paper` with a missing year.
- `isValidPaper` returns `false` for any input missing a field, with the wrong type for a field, or with a non-numeric/missing `publicationYear` — never throws. `references` must be an array in which every element is a valid `PaperSourceId` (an empty array is valid).
- `references` is an **FR-016 additive extension** to the 001 baseline, fixed here so the downstream collection/note-saving/graph-conversion features (`260702-002`/`003`/`006`) share one definition. It holds the sourceIds of the papers this paper *cites* (outbound only); `citedBy` is never stored — the graph feature derives it by inverting `references`. Populating `references` is those later features' responsibility; this contract only fixes its shape and validation.
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
