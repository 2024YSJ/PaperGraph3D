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
  recordFirstCoverage(subscription: Subscription, from: number): void;     // first forward check records coveredFrom = window.from (registration - 24h), once (FR-035)
  requestBackfill(subscription: Subscription, targetFrom: number): void;   // validate (FR-038), set backfillState, persist, fire onBackfillRequested? (FR-033)
  recordBackfillProgress(subscription: Subscription, cursor: number): void; // advance persisted cursor; on completion (cursor >= coveredFrom) lower coveredFrom = targetFrom and clear backfillState (FR-036)
}
```

Backed by a plain JSON-serializable array persisted through the plugin's own `loadData()`/`saveData()`; this feature only needs a `load: () => Promise<unknown[]>` / `save: (subs: Subscription[]) => Promise<void>` pair injected at construction, so it has no direct dependency on the `Plugin` instance itself. `load` is typed `unknown[]`, not `Subscription[]`, because the persisted file is plain JSON a user could hand-edit or that could be partially corrupted — `createSubscriptionStore` validates every element through 001's `isValidSubscription` on first consumption, keeping only the ones that pass and reporting any dropped count via an optional `onInvalidData` hook, rather than trusting the file's shape blindly. Because `loadData()`/`saveData()` is a single shared JSON blob also holding 001's `PluginSettings`, the injected `load`/`save` MUST be read-modify-write adapters over `{ settings: PluginSettings; subscriptions: Subscription[] }` (research.md Decision 15) — `subscriptionStore.ts` itself only ever sees its own slice and stays unaware that `PluginSettings` exists in the same object.

**`register` rejects an empty/whitespace-only value** (FR-025, Clarification 2026-07-06): `input.value.trim().length === 0` throws before anything else runs — no idempotency check, no persistence. **`register` is idempotent on `(type, value)`** (FR-001, Clarification 2026-07-06): before creating anything, it checks `list()` for an existing subscription with the same `type` and `value`; if found, that existing subscription is returned as-is and `input.label`/`input.checkIntervalHours` are ignored. `input.label` defaults to `input.value` when omitted. This is also what keeps `(type, value)` a safe, collision-free key for the scheduler's in-flight guard (Decision 14) — two subscriptions can never share a `(type, value)` pair.

**Immediate check on genuinely-new registration** (FR-028, research.md Decision 34): `SubscriptionStoreDeps` carries an optional `onRegistered?: (subscription) => void` that `register` fires **only** after persisting a genuinely-new subscription — never on the idempotent-hit path. `main.ts` (T020) wires it to the scheduler's `checkNow` handle so a new subscription is checked right away rather than up to ~15 min later; the callback seam keeps `subscriptionStore.ts` unaware `scheduler.ts` exists.

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
  from: number; // epoch ms; Subscription.lastCheckedAt, or (now - 24h) when null (Clarification 2026-07-05); clamped to never exceed `to` (research.md Decision 29)
  to: number;   // epoch ms; the moment this check/catch-up started
}
```

Used identically by a normal scheduled tick and a catch-up-on-load pass (research.md Decision 5) — there is exactly one code path that computes and consumes a `CollectionWindow`. If the system clock has moved backward such that `lastCheckedAt` is after `now`, `from` is clamped to `now` (`from = Math.min(lastCheckedAt ?? now - 24h, now)`), collapsing to an empty window rather than sending a provider an inverted range (FR-024). The subsequent `recordChecked(subscription, now)` then no-ops (its backward-guard leaves `lastCheckedAt` unchanged rather than moving it to the earlier `now`), so no already-covered span is re-searched when the clock returns to normal — this is the FR-024 behavior, superseding an earlier design that advanced `lastCheckedAt` backward.

## Subscription backfill state (User Story 5)

Backfill needs two pieces of per-subscription state that forward collection does not, added to 001's `Subscription` as **optional** fields — an FR-016-style additive extension exactly like `PluginSettings.semanticScholarApiKey`, not a modification of anything 001 already fixed:

```ts
// Added to src/models/subscription.ts's Subscription by this feature (both optional, absent by default):
interface Subscription {
  // ...001's existing fields...
  coveredFrom?: number | null;   // backward floor: the oldest instant this subscription's collection has covered (epoch ms).
                                 // First recorded at the first forward check as that window's `from` (registration - 24h) via recordFirstCoverage; lowered by a completed backfill. Absent/null on a subscription that has never been checked.
  backfillState?: { targetFrom: number; cursor: number } | null; // present only while a backfill is active.
                                 // cursor starts at targetFrom and advances upward toward coveredFrom; both epoch ms. Absent/null when no backfill is in progress.
}
```

`isValidSubscription` (001) is widened to **accept** these two optional fields (a subscription without them still validates — they are absent by default), so a persisted subscription round-trips through validation whether or not it has ever been backfilled. This is the same additive-validation change the `semanticScholarApiKey` extension made to `PluginSettings`; it is flagged as a cross-feature edit to a 001 file.

**Backfill Window** — derived per pass, never persisted as its own entity (parallel to Collection Window):

```ts
interface BackfillWindow {
  from: number; // epoch ms; backfillState.cursor (starts at targetFrom, advances upward)
  to: number;   // epoch ms; coveredFrom (the subscription's forward floor)
}

// Parallel to computeCollectionWindow; feeds the SAME runSubscriptionCheck, only the window differs.
function computeBackfillWindow(
  subscription: Pick<Subscription, 'coveredFrom' | 'backfillState'>,
): BackfillWindow | undefined; // undefined when no active backfillState (nothing to run)
```

**Store operations** (contracts § subscriptionStore.ts has the exact signatures):
- `recordFirstCoverage(subscription, from)` — called by the scheduler on a subscription's *first* forward check to initialize `coveredFrom = window.from` (registration − 24h). Idempotent: a no-op once `coveredFrom` is already set, so it never raises the floor.
- `requestBackfill(subscription, targetFrom)` — validates per FR-038 (reject empty/future/non-date; no-op when `targetFrom >= coveredFrom`), sets `backfillState = { targetFrom, cursor: targetFrom }` (or lowers an in-progress run's `targetFrom` when a further-past request arrives), persists, and fires an optional `onBackfillRequested?` callback that `main.ts` wires to the scheduler's `backfillNow` (parallel to how `onRegistered` wires to `checkNow`).
- `recordBackfillProgress(subscription, cursor)` — advances the persisted `cursor` after a pass; on completion (`cursor >= coveredFrom`) it lowers `coveredFrom = backfillState.targetFrom` and clears `backfillState`, so a later still-earlier request chains further down without overlap.

Backfill never calls `recordChecked` and never reads `lastCheckedAt` — the two watermarks are fully disjoint (FR-035).

## Provider response intermediate shapes

These exist only long enough to be mapped into a `PaperCandidate` (001) — they are never persisted and never handed to another feature (FR-008).

**Shared helper**: `stripArxivVersion(rawId: string): string` (defined once in `types.ts`, T003) strips a trailing `vN` suffix. Both `arxivParser.ts` and `semanticScholarParser.ts` call it — never each implement their own version-stripping — so a directly-collected paper's `sourceId` and any reference *to that same paper* arriving via Semantic Scholar enrichment always produce byte-identical `arxiv:`-scheme strings, which is what graph edge matching (006, exact `sourceId` equality) depends on.

```ts
// arxivParser.ts — one per <entry> in the Atom feed, produced by parseArxivEntry
// (research.md Decision 25), which returns undefined (never throws) for an entry
// too structurally incomplete to build one at all — e.g. no extractable <id>
// (FR-023, research.md Decision 28) — filtered out by every caller, not propagated.
interface ArxivEntry {
  arxivId: string;        // VERSION-STRIPPED base id (e.g. "2301.12345", never "2301.12345v2") via stripArxivVersion(); used to build sourceId = `arxiv:${arxivId}` (research.md Decision 13)
  title: string;
  authors: string[];
  publishedYear: number | undefined; // undefined if <published> missing/unparseable
  abstract: string;
}

// semanticScholarParser.ts — one per Semantic Scholar paper object
interface SemanticScholarPaper {
  paperId: string;
  arxivId: string | undefined;       // externalIds.ArXiv, VERSION-STRIPPED same as ArxivEntry.arxivId, when present
  citationCount: number;
  references: SemanticScholarReference[];
}

interface SemanticScholarReference {
  arxivId: string | undefined;       // VERSION-STRIPPED, same rule as above
  semanticScholarId: string;
}
```

**Mapping to `PaperSourceId` (001)**: an `ArxivEntry` always maps to `` `arxiv:${arxivId}` `` (version-stripped, research.md Decision 13). A `SemanticScholarReference` maps to `` `arxiv:${arxivId}` `` when `arxivId` is present, otherwise `` `semanticScholar:${semanticScholarId}` `` (Clarification 2026-07-05, research.md Decision 9) — and that `arxivId` MUST be stripped of any trailing `vN` version suffix using the exact same rule as `ArxivEntry.arxivId`, **not** assumed to already arrive version-free from Semantic Scholar's `externalIds.ArXiv` field. Without this, a directly-collected paper's version-stripped `sourceId` and a reference *to that same paper* arriving via enrichment could carry different `sourceId` strings, silently breaking graph edge matching (006) for any paper that has ever been revised.

## Enrichment

```ts
type EnrichmentOutcome =
  | { status: 'enriched'; citationCount: number; references: PaperSourceId[] }
  | { status: 'terminalAbsence' }   // arXiv ID has no Semantic Scholar record (404) — not retried by this feature
  | { status: 'transientFailure' }; // exhausted bounded retries this pass — not retried further by this feature

function enrichFromSemanticScholar(
  candidates: PaperCandidate[],       // the whole surviving candidate set for a check (batch, research.md Decision 33)
  apiKey: string | undefined,         // PluginSettings.semanticScholarApiKey (FR-020)
): Promise<Map<PaperSourceId, EnrichmentOutcome>>; // one outcome per candidate, keyed by sourceId
```

Enrichment is **batched** (FR-027, research.md Decision 33): the surviving candidate set is enriched via Semantic Scholar's `POST /paper/batch` endpoint (≤500 ids/request, chunked when more) — roughly one request for a whole check, never one request per paper — instead of the earlier one-`GET`-per-paper shape (which would systematically hit the shared unauthenticated rate limit). A candidate the batch reports no record for (`null` element) → `terminalAbsence`; a whole-chunk `429`/network failure → `transientFailure` for every id in that chunk after bounded retry. `terminalAbsence` and `transientFailure` are distinguished only for observability/logging — both leave the candidate's `citationCount`/`references` as `undefined`, so both promote identically with `citationsKnown = false` (FR-018). Neither is retried again within this feature; only 005's manual refresh or a future auto-heal may re-attempt (out of scope here). The single-paper `GET` lookup is retained in the provider client for 005's per-paper refresh, not used by 002 collection.

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

**Two-phase `runCollectionPass`** (research.md Decision 33): because enrichment is batched, `runCollectionPass` first *drains* its candidate iterable into an array (bounded ≤1,000 by the arXiv cap, Decision 11) and applies the `seen`/`alreadyPersisted`/year-gate filters, then batch-enriches the survivors in one `enrichFromSemanticScholar` call, then runs the sequential (one-at-a-time, event-loop-yielding — Decision 6) summarize→persist loop using the pre-fetched outcome map. The "no UI freeze" guarantee (FR-013) is preserved for the expensive per-paper summarize/persist work; only the cheap enrichment network call moves out of the per-candidate loop into a single batched phase.

**Applying the outcome before promotion** (research.md Decision 33, gap closed in analysis review): `enrichFromSemanticScholar` only returns a `Map<PaperSourceId, EnrichmentOutcome>` — it never mutates a candidate. Since `promote` (= 001's `toPaper`) derives `citationsKnown` from the *candidate's own* `citationCount !== undefined`, Phase 2 MUST look up each survivor's outcome and, when `status === 'enriched'`, overwrite the candidate's `citationCount`/`references` with the outcome's values **before** calling `promote` — otherwise a successfully-enriched paper would still promote with `citationsKnown = false`, silently defeating enrichment. For `'terminalAbsence'`/`'transientFailure'`, the candidate passes to `promote` unchanged.

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
  alreadyPersisted: (sourceId: Paper['sourceId']) => Promise<boolean>;
}

// runCollectionPass(candidates, hooks, isSummarizationEnabled, getSemanticScholarApiKey, enrich?) —
// isSummarizationEnabled/getSemanticScholarApiKey are FUNCTIONS, called live each time,
// never captured booleans/strings (research.md Decision 26, FR-021) — see below. `enrich`
// is an OPTIONAL DI seam (research.md Decision 36): omitted in production (defaults to the
// real enrichFromSemanticScholar), but overridable by quickstart.md/tests so a check that
// exercises enrichment never has to make a live network call — enrichment is NOT a
// PipelineHooks field (it isn't owned by a not-yet-existing feature like 003/004 are), but
// it needed the same kind of injectable default those hooks already have.
```

Injected, not imported — `pipeline.ts` calls exactly these two hooks in order (summarize, if present and `isSummarizationEnabled()` is `true` at that moment; then persist, passing the `summarize` result straight through as `persist`'s second argument) and implements neither (research.md Decision 10). A `summarize` rejection/timeout is caught and treated as "no summary" — `persist` is still called, with `summary` simply omitted/`undefined` (research.md Decision 22; this is what "004's abstract fallback applies and the paper is still saved" in FR-017 actually means at the call-signature level).

**Live re-check after `summarize` resolves** (research.md Decision 26, FR-021): `isSummarizationEnabled()` is called again right after `hooks.summarize` resolves, not just before calling it. If summarization was turned off in the meantime, the result is discarded (`summary` still passed as `undefined`) — this is how this feature satisfies 004's own FR-009 ("discarding any in-flight generation"), since 004 itself has no way to know the setting changed after it was invoked. `main.ts` (T020) wires both getters as `() => this.settings.X`, read through the plugin instance at call time, never a value captured into a local variable when the scheduler was constructed during `onload`.

**`runSubscriptionCheck`** (research.md Decision 24) is the composition function this feature ships as `startScheduler`'s `runCheck` dependency: `queryArxiv` → `parseArxivEntry` (per already-parsed entry — not `parseArxivAtom`, which takes a whole document; research.md Decision 25) → `runCollectionPass`. No task before this composed it — earlier drafts of this data model implicitly assumed `runCheck` existed without any task actually building it.

## Scheduler state

```ts
interface ScheduledCheckState {
  // No new persisted fields — reads/writes only Subscription.lastCheckedAt (001).
  // "Due" for subscription s at time now: s.enabled && now >= (s.lastCheckedAt ?? -Infinity) + s.checkIntervalHours * 3_600_000
  inFlight: Set<string>;             // in-memory only; keyed by `${type}:${value}`, NOT by object reference (research.md Decision 14)
  failing: Map<string, 'unreachable' | 'truncated'>; // once-per-reason notice gating (FR-012a), same keying
  noProgress: Map<string, number>;  // successive truncated-but-no-forward-progress passes per subscription (FR-026 escape); reset on any progress, bounded by MAX_NOPROGRESS_PASSES
}
```

The scheduler introduces no new *persisted* entity: due-ness is a pure function of a `Subscription`'s own existing fields (001) and the current time. `inFlight` is purely in-memory, reset empty on every load, and exists only to stop the catch-up pass, a recurring tick, and an immediate on-register check (`checkNow`) from invoking `runCheck` for the same subscription concurrently. It is keyed by a `type:value` string, not the `Subscription` object itself, because `getSubscriptions()` is not guaranteed to return the same object instances across separate calls (research.md Decision 14). When multiple subscriptions are due in the same pass, `startScheduler` processes them one after another (`for...of` + `await`), never concurrently (FR-022, research.md Decision 27) — `inFlight` therefore never has more than one entry added at the exact same instant in practice, though the guard itself would still be correct even if that changed.

**Recording the covered boundary** (FR-026, research.md Decision 32): `runCheck` returns `{ truncated, coveredThrough }`, and the scheduler records `lastCheckedAt` via `onSubscriptionChecked(subscription, coveredThrough)` — the covered boundary, `=== window.to` for a fully-covered window or the newest fetched paper's submission time for a truncated one — never `window.to` unconditionally. This is what makes a truncated window resumable across successive checks instead of losing its uncovered tail.

**`checkNow` handle** (FR-028 **and FR-032**, research.md Decision 34): `startScheduler` returns `{ checkNow(subscription): Promise<void>; backfillNow(subscription): Promise<void> }`. `checkNow` runs one subscription through the identical due-check path (same `computeCollectionWindow`, same `inFlight` guard, same `runCheck`/`onSubscriptionChecked`/`onFailure`), a no-op if the subscription is not `enabled`. `main.ts` wires it to `subscriptionStore`'s `onRegistered` for the immediate first check of a *new* subscription (FR-028); the **same handle** is what a user-triggered on-demand check of an *existing* subscription (FR-032) calls — no second implementation, since FR-032 is exactly "run the same immediate check, but for a subscription that already exists." The user-facing trigger (command/button) for FR-032 is 008's, per spec Out of Scope.

**`backfillNow` handle** (FR-033–040): the backward-collection counterpart to `checkNow`. It runs `backfill.ts`'s runner for one subscription — resuming its active `backfillState` pass-by-pass over `computeBackfillWindow(subscription)` (oldest-first), through the **same `runCheck`/`runSubscriptionCheck`** forward collection uses (only the window differs) and the **same `inFlight` guard** (so a subscription's backfill pass and forward tick can never run concurrently — FR-039), recording progress via `recordBackfillProgress` instead of `recordChecked` (so `lastCheckedAt` is never touched — FR-035), and surfacing failures via the same `onFailure` path (FR-040). It is a no-op if the subscription is not `enabled` (disable pauses backfill — FR-037). `main.ts` wires it to `subscriptionStore`'s `onBackfillRequested`; the recurring tick and the catch-up-on-load pass also resume any subscription with an active `backfillState`, so a large history continues across ticks and plugin restarts.

**Re-enable needs no special case** (FR-029, research.md Decision 35): since `lastCheckedAt` does not move while a subscription is disabled, the ordinary `computeCollectionWindow` spans the whole disabled period on the next check — a catch-up, exactly like a plugin-was-off gap — and Decision 32 covers an over-large such window without loss.

## Cross-entity notes

- This feature adds three optional fields to 001's baseline, all FR-016-style additive extensions (each optional and absent by default, none removing or redefining a 001 field): `PluginSettings.semanticScholarApiKey?: string` (read by `semanticScholarClient.ts`, research.md Decision 12, FR-020) in `settings.ts`, and `Subscription.coveredFrom?` + `Subscription.backfillState?` (backfill watermarks, FR-033–040) in `subscription.ts`, with `isValidSubscription` widened to accept the latter two. It adds nothing to `Paper`. For forward collection it reads `Subscription.{type,value,checkIntervalHours,lastCheckedAt,enabled}` and `PluginSettings.{summarizationEnabled,semanticScholarApiKey}`; for backfill it additionally reads/writes `Subscription.{coveredFrom,backfillState}`. It produces `Paper` values via 001's own `toPaper` in both cases.
- No association object (e.g. "which subscription found which paper") is introduced — per 001's data model, that link is explicitly this feature's concern but is not required to be persisted; a paper's `sourceId` alone is sufficient for the dedup/exists-already checks this feature needs (see `CollectionRunState.alreadyPersisted`).
