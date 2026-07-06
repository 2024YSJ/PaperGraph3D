# Phase 1 Data Model: Subscription-Based Paper Collection

Source: `spec.md` (Key Entities, Functional Requirements, Clarifications). This feature introduces no new *persisted* entities — `Subscription`, `PaperCandidate`, and `Paper` remain exactly as defined in `001-core-data-models` (`src/models/subscription.ts`, `src/models/paper.ts`), and this feature reads/writes only the fields 001 already defines (`Subscription.lastCheckedAt`, `Paper.citationsKnown`, etc.). What follows is the in-memory design that turns provider responses into those existing shapes. See `research.md` for the reasoning behind each choice and `contracts/` for the exact exported function signatures.

## Subscription store (User Story 1)

No new entity — this is a persistence + CRUD layer over 001's existing `Subscription` type, since neither 001 (shape only) nor any earlier feature owns storing the subscription list. 008's clarification confirms 008 builds only the settings-screen UI and calls into whichever feature owns the underlying data; for subscriptions, that is this feature.

```ts
interface SubscriptionStore {
  list(): Subscription[];
  register(input: { type: SubscriptionType; value: string; label?: string; checkIntervalHours?: CheckIntervalHours }): Subscription;
  remove(subscription: Subscription): void;
  setEnabled(subscription: Subscription, enabled: boolean): void;
  setCheckInterval(subscription: Subscription, requested: number): void; // delegates to 001's assignCheckInterval
  recordChecked(subscription: Subscription, checkedThrough: number): void; // used by scheduler.ts, FR-006
}
```

Backed by a plain JSON-serializable array persisted through the plugin's own `loadData()`/`saveData()`; this feature only needs a `load: () => Promise<Subscription[]>` / `save: (subs: Subscription[]) => Promise<void>` pair injected at construction, so it has no direct dependency on the `Plugin` instance itself. Because `loadData()`/`saveData()` is a single shared JSON blob also holding 001's `PluginSettings`, the injected `load`/`save` MUST be read-modify-write adapters over `{ settings: PluginSettings; subscriptions: Subscription[] }` (research.md Decision 15) — `subscriptionStore.ts` itself only ever sees its own `Subscription[]` slice and stays unaware that `PluginSettings` exists in the same object.

**`register` is idempotent on `(type, value)`** (FR-001, Clarification 2026-07-06): before creating anything, it checks `list()` for an existing subscription with the same `type` and `value`; if found, that existing subscription is returned as-is and `input.label`/`input.checkIntervalHours` are ignored. `input.label` defaults to `input.value` when omitted. This is also what keeps `(type, value)` a safe, collision-free key for the scheduler's in-flight guard (Decision 14) — two subscriptions can never share a `(type, value)` pair.

## `PluginSettings` extension (FR-020)

The only field this feature adds to 001's baseline (an FR-016-style additive extension, not a modification of anything 001 already fixed):

```ts
// Added to src/models/settings.ts's PluginSettings by this feature:
interface PluginSettings {
  // ...001's existing fields...
  semanticScholarApiKey?: string; // optional; absent by default; read by semanticScholarClient.ts
}
```

Absent (`undefined`) by default — enrichment behaves exactly as already specified (Decisions 7/12) when no key is configured; when present, `semanticScholarClient.ts` includes it as an `x-api-key` request header on every Semantic Scholar call (research.md Decision 12).

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
  arxivId: string;        // VERSION-STRIPPED base id (e.g. "2301.12345", never "2301.12345v2"); used to build sourceId = `arxiv:${arxivId}` (research.md Decision 13)
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
  | { status: 'terminalAbsence' }   // arXiv ID has no Semantic Scholar record (404) — not retried by this feature
  | { status: 'transientFailure' }; // exhausted bounded retries this pass — not retried further by this feature

function enrichFromSemanticScholar(
  candidate: PaperCandidate,
  apiKey: string | undefined, // PluginSettings.semanticScholarApiKey (FR-020)
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
  alreadyPersisted: (id: PaperSourceId) => Promise<boolean>; // hook into 003 (research.md Decision 8); 003 does not yet define this capability (research.md Decision 23)
}
```

`CollectionRunState` never survives past a single scheduled tick or catch-up pass — it is constructed fresh each time `scheduler.ts` fires a check, per subscription-check-or-catch-up run (not shared across subscriptions run in the same tick, since two subscriptions checked in the same tick still need cross-subscription dedup — see contract in `contracts/collection-pipeline.md`).

## Pipeline hooks (FR-017)

```ts
interface SummarizationInput {
  // Deliberately NOT the full Paper — only the four fields 004 actually needs
  // (research.md Decision 22), so an external summarization provider never
  // receives sourceId/references/authors/publicationYear it has no use for.
  title: string;
  abstract: string;
  citationCount: number;
  citationsKnown: boolean;
}

interface SummaryResult {
  summary: string;
  futureDirections: string;
}

interface PipelineHooks {
  summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>;
  persist: (paper: Paper, summary?: SummaryResult) => Promise<void>;
}
```

Injected, not imported — `pipeline.ts` calls exactly these two hooks in order (summarize, if present and `PluginSettings.summarizationEnabled` (001) is true; then persist, passing the `summarize` result straight through as `persist`'s second argument) and implements neither (research.md Decision 10). A `summarize` rejection/timeout is caught and treated as "no summary" — `persist` is still called, with `summary` simply omitted/`undefined` (research.md Decision 22; this is what "004's abstract fallback applies and the paper is still saved" in FR-017 actually means at the call-signature level).

## Scheduler state

```ts
interface ScheduledCheckState {
  // No new persisted fields — reads/writes only Subscription.lastCheckedAt (001).
  // "Due" for subscription s at time now: s.enabled && now >= (s.lastCheckedAt ?? -Infinity) + s.checkIntervalHours * 3_600_000
  inFlight: Set<string>; // in-memory only; keyed by `${type}:${value}`, NOT by object reference (research.md Decision 14)
}
```

The scheduler introduces no new *persisted* entity: due-ness is a pure function of a `Subscription`'s own existing fields (001) and the current time. `inFlight` is purely in-memory, reset empty on every load, and exists only to stop the catch-up pass and a recurring tick from invoking `runCheck` for the same subscription concurrently. It is keyed by a `type:value` string, not the `Subscription` object itself, because `getSubscriptions()` is not guaranteed to return the same object instances across separate calls (research.md Decision 14).

## Cross-entity notes

- This feature adds exactly one field to 001's baseline, as an FR-016-style additive extension: `PluginSettings.semanticScholarApiKey?: string` (optional; absent by default), read by `semanticScholarClient.ts` (research.md Decision 12, FR-020). It otherwise adds nothing to `Subscription`/`Paper` — it only reads `Subscription.{type,value,checkIntervalHours,lastCheckedAt,enabled}` and `PluginSettings.{summarizationEnabled,semanticScholarApiKey}`, and produces `Paper` values via 001's own `toPaper`.
- No association object (e.g. "which subscription found which paper") is introduced — per 001's data model, that link is explicitly this feature's concern but is not required to be persisted; a paper's `sourceId` alone is sufficient for the dedup/exists-already checks this feature needs (see `CollectionRunState.alreadyPersisted`).
