# Phase 1 Data Model: Subscription-Based Paper Collection

Source: `spec.md` (Key Entities, Functional Requirements, Clarifications). This feature introduces no new *persisted* entities — `Subscription`, `PaperCandidate`, and `Paper` remain exactly as defined in `001-core-data-models` (`src/models/subscription.ts`, `src/models/paper.ts`), and this feature reads/writes only the fields 001 already defines (`Subscription.lastCheckedAt`, `Paper.citationsKnown`, etc.). What follows is the in-memory design that turns provider responses into those existing shapes. See `research.md` for the reasoning behind each choice and `contracts/` for the exact exported function signatures.

## Subscription store (User Story 1)

No new entity — this is a persistence + CRUD layer over 001's existing `Subscription` type, since neither 001 (shape only) nor any earlier feature owns storing the subscription list. 008's clarification confirms 008 builds only the settings-screen UI and calls into whichever feature owns the underlying data; for subscriptions, that is this feature.

```ts
interface SubscriptionStore {
  list(): Subscription[];
  register(input: { type: SubscriptionType; value: string; label: string; checkIntervalHours?: CheckIntervalHours }): Subscription;
  remove(subscription: Subscription): void;
  setEnabled(subscription: Subscription, enabled: boolean): void;
  setCheckInterval(subscription: Subscription, requested: number): void; // delegates to 001's assignCheckInterval
  recordChecked(subscription: Subscription, checkedThrough: number): void; // used by scheduler.ts, FR-006
}
```

Backed by a plain JSON-serializable array persisted through the plugin's own `loadData()`/`saveData()` (wired by 008 at load/save time; this feature only needs a `load: () => Promise<Subscription[]>` / `save: (subs: Subscription[]) => Promise<void>` pair injected at construction, so it has no direct dependency on the `Plugin` instance itself).

## Collection Window (spec Key Entities)

Not a stored type — derived per run:

```ts
interface CollectionWindow {
  from: number; // epoch ms; Subscription.lastCheckedAt, or (now - 24h) when null (Clarification 2026-07-05)
  to: number;   // epoch ms; the moment this check/catch-up started
}
```

Used identically by a normal scheduled tick and a catch-up-on-load pass (research.md Decision 5) — there is exactly one code path that computes and consumes a `CollectionWindow`.

## Provider response intermediate shapes

These exist only long enough to be mapped into a `PaperCandidate` (001) — they are never persisted and never handed to another feature (FR-008).

```ts
// arxivParser.ts — one per <entry> in the Atom feed
interface ArxivEntry {
  arxivId: string;        // used to build sourceId = `arxiv:${arxivId}`
  title: string;
  authors: string[];
  publishedYear: number | undefined; // undefined if <published> missing/unparseable
  abstract: string;
}

// semanticScholarParser.ts — one per Semantic Scholar paper object
interface SemanticScholarPaper {
  paperId: string;
  arxivId: string | undefined;       // externalIds.ArXiv, when present
  citationCount: number;
  references: SemanticScholarReference[];
}

interface SemanticScholarReference {
  arxivId: string | undefined;
  semanticScholarId: string;
}
```

**Mapping to `PaperSourceId` (001)**: an `ArxivEntry` always maps to `` `arxiv:${arxivId}` ``. A `SemanticScholarReference` maps to `` `arxiv:${arxivId}` `` when `arxivId` is present, otherwise `` `semanticScholar:${semanticScholarId}` `` (Clarification 2026-07-05, research.md Decision 9).

## Enrichment

```ts
type EnrichmentOutcome =
  | { status: 'enriched'; citationCount: number; references: PaperSourceId[] }
  | { status: 'terminalAbsence' }   // positive "no such paper" or unresolved identity match — not retried by this feature
  | { status: 'transientFailure' }; // exhausted bounded retries this pass — not retried further by this feature

function enrichFromSemanticScholar(
  candidate: PaperCandidate,
): Promise<EnrichmentOutcome>;
```

`terminalAbsence` and `transientFailure` are distinguished only for observability/logging (e.g., surfacing a clearer failure reason to the user) — both leave the candidate's `citationCount`/`references` as `undefined`, so both promote identically with `citationsKnown = false` (FR-018). Neither is retried again within this feature; only 005's manual refresh or a future auto-heal may re-attempt (out of scope here).

## Promotion (delegates to 001)

```ts
function promote(candidate: PaperCandidate): Paper | undefined; // = 001's toPaper(candidate)
```

No new promotion logic is introduced — `promotion.ts` is a thin call-through to `src/models/paper.ts`'s existing `toPaper`, kept as its own module only so `pipeline.ts` has one obvious place to call for "turn this candidate into a storable paper," per the Key Entities description in `spec.md`.

## Dedup and batch state (in-memory only, one collection run)

```ts
interface CollectionRunState {
  seen: Set<PaperSourceId>;             // entries already processed this run (FR-009)
  alreadyPersisted: (id: PaperSourceId) => Promise<boolean>; // hook into 003 (research.md Decision 8)
}
```

`CollectionRunState` never survives past a single scheduled tick or catch-up pass — it is constructed fresh each time `scheduler.ts` fires a check, per subscription-check-or-catch-up run (not shared across subscriptions run in the same tick, since two subscriptions checked in the same tick still need cross-subscription dedup — see contract in `contracts/collection-pipeline.md`).

## Pipeline hooks (FR-017)

```ts
interface PipelineHooks {
  summarize?: (paper: Paper) => Promise<{ summary: string; futureDirections: string } | undefined>;
  persist: (paper: Paper) => Promise<void>;
}
```

Injected, not imported — `pipeline.ts` calls exactly these two hooks in order (summarize, if present and `PluginSettings.summarizationEnabled` (001) is true; then persist) and implements neither (research.md Decision 10). A `summarize` rejection/timeout is caught and treated as "no summary," never blocking `persist`.

## Scheduler state

```ts
interface ScheduledCheckState {
  // No new persisted fields — reads/writes only Subscription.lastCheckedAt (001).
  // "Due" for subscription s at time now: s.enabled && now >= (s.lastCheckedAt ?? -Infinity) + s.checkIntervalHours * 3_600_000
}
```

The scheduler introduces no new persisted entity: due-ness is a pure function of a `Subscription`'s own existing fields (001) and the current time.

## Cross-entity notes

- This feature never adds fields to `Subscription`/`Paper`/`PluginSettings` (001) — it only reads `Subscription.{type,value,checkIntervalHours,lastCheckedAt,enabled}` and `PluginSettings.summarizationEnabled`, and produces `Paper` values via 001's own `toPaper`.
- No association object (e.g. "which subscription found which paper") is introduced — per 001's data model, that link is explicitly this feature's concern but is not required to be persisted; a paper's `sourceId` alone is sufficient for the dedup/exists-already checks this feature needs (see `CollectionRunState.alreadyPersisted`).
