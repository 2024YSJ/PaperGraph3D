---

description: "Task list for Subscription-Based Paper Collection"
---

# Tasks: Subscription-Based Paper Collection

**Input**: Design documents from `/specs/002-subscription-paper-collection/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/collection-pipeline.md

**Tests**: Not explicitly requested in `spec.md`. `plan.md`/`research.md` follow 001's precedent of no test framework in this repo. Correctness relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough (stubbed provider responses, no live network) — see the Polish phase.

**Organization**: Tasks are grouped by user story (Subscription management = P1/US1, Scheduled collection = P1/US2, Catch-up collection = P1/US3, Provider parsing & enrichment = P2/US4, Backfill historical papers on demand = P3/US5, Check an existing subscription now = P3/US6, per `spec.md`) so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4, US5, US6)
- Every description includes the exact file path

## Path Conventions

Single project (this repo is one Obsidian plugin bundle, no frontend/backend split). All new files live under `src/collection/`, per `plan.md`'s Project Structure. Three existing files are touched: `src/main.ts` (Polish phase, scheduler wiring — T020), `src/models/settings.ts` (Foundational phase, one additive optional field — T002a), and `src/models/subscription.ts` (US5/backfill phase, two additive optional fields + widened `isValidSubscription` — T025); no other existing file is modified.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [ ] T001 Create the `src/collection/` directory and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline (with 001's `src/models/` already present), so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to start adding collection modules.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by more than one user story — everything scheduled/catch-up collection (US2/US3) needs to read and update subscriptions, which is also this feature's own US1 concern, so the storage layer goes first.

- [ ] T002a [P] Add the single optional field `semanticScholarApiKey?: string` to the `PluginSettings` interface in `src/models/settings.ts` (an FR-016-permitted additive extension of 001's baseline — no existing 001 field is removed or redefined, and `DEFAULT_PLUGIN_SETTINGS` is left unchanged since the field is optional/absent-by-default), so that `main.ts`'s live getter `() => this.settings.semanticScholarApiKey` (T020) type-checks under `strict: true` (`semanticScholarClient.ts`/`enrichment.ts` receive the key as a plain `string | undefined` parameter and do not read settings themselves, per `contracts/collection-pipeline.md`). Per `data-model.md` § `PluginSettings` extension (FR-020; blocks T020)
- [ ] T002 [P] Implement `subscriptionStore.ts`'s `createSubscriptionStore(deps)` with `list()`, `register()`, `remove()`, `setEnabled()`, `setCheckInterval()` (delegating to 001's `assignCheckInterval`, per 001's own FR-005 rejection rule — reused here, not one of this spec's FRs), and `recordChecked()`, where `deps` includes an optional `onRegistered?: (subscription) => void` callback (fired by `register` only on genuinely-new registration, wired to the scheduler's `checkNow` by T020 — FR-028, research.md Decision 34) in `src/collection/subscriptionStore.ts` (per `contracts/collection-pipeline.md` § subscriptionStore.ts and `data-model.md` § Subscription store) (FR-001, FR-002, FR-006, FR-010). `deps.load()` returns `unknown[]`, not `Subscription[]` — on first consumption, filter every element through 001's `isValidSubscription`, keep only the ones that pass, and call `deps.onInvalidData?.(droppedCount)` once if any were dropped (never throw on a corrupted/hand-edited persisted file); this is what prevents a malformed record from making the scheduler's due-check arithmetic evaluate to `NaN`/garbage for that one subscription.
- [ ] T003 [P] Define the shared in-memory intermediate types (`CollectionWindow`, `ArxivEntry`, `SemanticScholarPaper`, `SemanticScholarReference`, `EnrichmentOutcome`, `CollectionRunState`, `PipelineHooks`) in a small shared types module `src/collection/types.ts` (per `data-model.md`), including a shared `stripArxivVersion(rawId: string): string` helper (strips a trailing `vN` suffix) so `arxivParser.ts` (T008) and `semanticScholarParser.ts` (T009) both normalize arXiv IDs the exact same way (research.md Decision 9/13) without depending on each other

**Checkpoint**: Subscription storage, shared types, and the `PluginSettings.semanticScholarApiKey` extension field all exist — US1 can be validated standalone; US2/US3/US4 have what they need to build on, and T020's settings getter will type-check.

---

## Phase 3: User Story 1 - Register and manage subscriptions (Priority: P1) 🎯 MVP

**Goal**: Let any caller (eventually 008's settings UI) register, list, enable/disable, delete, and re-interval a subscription, with every change durably persisted.

**Independent Test**: Using a stubbed `load`/`save` pair (no real Obsidian `Plugin` instance needed), register a subscription of each type, view the list, disable one, delete another, change another's check interval, and confirm each action is reflected in what `save` receives — per `quickstart.md` § Subscription management.

### Implementation for User Story 1

- [ ] T004 [US1] Wire `register()` to: reject (throw) when `input.value.trim().length === 0`, before anything else (FR-025, SC-011, research.md Decision 30); otherwise default `label` to `value` when omitted; apply `DEFAULT_CHECK_INTERVAL_HOURS` (001) when no interval is supplied; check `list()` for an existing subscription with the same `type`+`value` first and return it unchanged (ignoring the new call's `label`/`checkIntervalHours`) rather than creating a duplicate (research.md Decision 20); and otherwise persist the new subscription via `deps.save` and then fire `deps.onRegistered?.(subscription)` (only on this genuinely-new path, never on the idempotent-hit return above — FR-028, research.md Decision 34) before resolving — in `src/collection/subscriptionStore.ts` (FR-001, FR-025, FR-028, SC-009, SC-011; depends on T002)
- [ ] T005 [US1] Confirm `remove()`/`setEnabled()`/`setCheckInterval()` each persist via `deps.save` before resolving and that `setCheckInterval` on a disallowed value leaves the stored interval unchanged (per 001's FR-005 rejection rule, applied at the store layer — see FR-002 for this feature's own "user MUST be able to change an existing subscription's check interval" requirement), in `src/collection/subscriptionStore.ts` (FR-002, FR-010; depends on T002, T004)

**Checkpoint**: User Story 1 is fully functional and independently testable — `subscriptionStore.ts` satisfies SC-005 (disabling stops later collection, verified fully once US2/US3 consume it) at the storage layer.

---

## Phase 4: User Story 4 - Provider parsing and citation enrichment (Priority: P2)

**Goal**: Turn a raw arXiv Atom XML response and a raw Semantic Scholar JSON response into the shared `PaperCandidate`/`Paper` shape (001), with `citationsKnown` correctly distinguishing "unconfirmed" from "confirmed zero."

**Independent Test**: Feed a stubbed arXiv Atom XML string and a stubbed Semantic Scholar JSON object through parsing and confirm both produce the correct `PaperCandidate`/enrichment output, per `quickstart.md` § Provider parsing.

**Note**: Implemented ahead of US2/US3 (despite lower priority) because the scheduler (US2/US3) has nothing to schedule without a way to query and parse a provider response — this is a dependency ordering choice, not a change to the spec's priority for user-facing value.

### Implementation for User Story 4

- [ ] T006 [P] [US4] Implement `buildArxivSearchUrl(subscription, window, page)` as a pure, network-free function — stripping literal `"` from `subscription.value` before building the type-specific `search_query` clause, combining it with `submittedDate:[from TO to]` formatted via UTC-based `Date` accessors only (never local-timezone accessors — research.md Decision 19), `encodeURIComponent`-encoding the assembled query string (research.md Decision 18), and appending the fixed ordering params `&sortBy=submittedDate&sortOrder=ascending` (never arXiv's default relevance sort — FR-026, research.md Decision 32) — then implement `queryArxiv(subscription, window)` using `requestUrl` and `buildArxivSearchUrl`, paging via `start`/`max_results=100` up to a 10-page (1,000-entry) safety cap with a 3-second delay between page requests, parsing each page's response with `DOMParser` itself (no dependency on `arxivParser.ts` — research.md Decision 25) to extract and count `<entry>` nodes for the pagination check, returning those `Element[]` entries plus a `truncated` flag when the cap is hit **and** a `coveredThrough` epoch-ms value — `window.to` when fully covered, else the `<published>` time of the last (newest, since ascending) entry fetched; if that newest entry's `<published>` is missing/unparseable, scan backward among fetched entries for the first one with a valid `<published>`, and if none exists at all, fall back to `window.from` (never `NaN`/thrown, since this feeds the persisted `lastCheckedAt`) (FR-026, research.md Decision 32) — in `src/collection/arxivClient.ts` (per `contracts/collection-pipeline.md` § arxivClient.ts and `research.md` Decisions 11, 18, 19, 25, 32) — arXiv being the sole discovery query here (Semantic Scholar is never queried for discovery) is what realizes FR-031 (FR-008, FR-014, FR-026, FR-031)
- [ ] T007 [P] [US4] Implement `fetchSemanticScholarBatch(arxivIds, apiKey)` (002's collection enrichment path) using `requestUrl` against `POST /graph/v1/paper/batch?fields=citationCount,references.paperId,references.externalIds` with body `{ ids: arxivIds.map(id => `ARXIV:${id}`) }`, splitting into chunks of ≤500 ids (one request per chunk), returning an index-aligned array of `{body} | null | {status: 429} | {status: 'networkError'}` (a `null` element = provider has no record for that id; a chunk-level `429`/network failure retried a bounded 3× before its ids become failure placeholders) — never throwing — AND retain `fetchSemanticScholarPaper(arxivId, apiKey)` (`GET /graph/v1/paper/ARXIV:<arxivId>`, typed `{status:200,body}|{status:404}|{status:429}|{status:'networkError'}`) for 005's per-paper refresh; both add an `x-api-key` header when `apiKey` is provided and omit it when `undefined`, in `src/collection/semanticScholarClient.ts` (per `contracts/collection-pipeline.md` § arxivClient.ts/semanticScholarClient.ts and `research.md` Decisions 12, 33) (FR-008, FR-020, FR-027)
- [ ] T008 [P] [US4] Implement `parseArxivEntry(entry: Element): PaperCandidate | undefined` — mapping a single already-parsed Atom `<entry>` node to a `PaperCandidate` with `citationCount`/`references` left `undefined` and `sourceId` built as `` `arxiv:${stripArxivVersion(rawId)}` `` (T003's shared helper) from the entry's `<id>` element, returning `undefined` (never throwing) when the entry has no extractable `<id>` or is otherwise too incomplete to build a candidate (FR-023, research.md Decision 28) — plus `parseArxivAtom(xml: string): PaperCandidate[]` as a thin wrapper (`DOMParser.parseFromString(xml)` → each `<entry>` → `parseArxivEntry`, filtering out `undefined` results, no logic of its own, kept for `quickstart.md`/manual testing) in `src/collection/arxivParser.ts` (per `data-model.md` § Provider response intermediate shapes and `research.md` Decision 13/25/28) (FR-007, FR-015, FR-019, FR-023; depends on T003)
- [ ] T009 [P] [US4] Implement `parseSemanticScholarPaper(body): SemanticScholarPaper` (passing every arXiv ID it reads — the paper's own and each reference's — through T003's `stripArxivVersion`, never assuming Semantic Scholar's `externalIds.ArXiv` already arrives version-free) and `toPaperSourceId(reference): PaperSourceId` (`` `arxiv:${arxivId}` `` when present, else `` `semanticScholar:${semanticScholarId}` ``) in `src/collection/semanticScholarParser.ts` (per `contracts/collection-pipeline.md` § arxivParser.ts/semanticScholarParser.ts and `research.md` Decision 9/13) (FR-019; Clarification 2026-07-05 § sourceId scheme; depends on T003)
- [ ] T010 [US4] Implement `enrichFromSemanticScholar(candidates, apiKey): Promise<Map<PaperSourceId, EnrichmentOutcome>>` (**batched**, research.md Decision 33) — extract each candidate's plain arXiv ID by stripping its `` `arxiv:` `` prefix, call `fetchSemanticScholarBatch` (T007) once with the whole id list and `apiKey` (arXiv-ID-only match, no title/author fallback; the client chunks to ≤500/request); for each response element that is a paper object, call `parseSemanticScholarPaper` (T009) then map each reference through `toPaperSourceId` (T009) to build `{status:'enriched', citationCount, references}`; map a `null` element to `'terminalAbsence'` and a chunk-level `429`/`'networkError'` (after the client's bounded retry) to `'transientFailure'` for each id in it; key every outcome by the candidate's full `sourceId` — in `src/collection/enrichment.ts` (per `contracts/collection-pipeline.md` § enrichment.ts and `research.md` Decisions 12, 33) (FR-016, FR-018, FR-020, FR-027; depends on T007, T009)
- [ ] T011 [US4] Implement `promote(candidate): Paper | undefined` as a thin call-through to 001's `toPaper`, in `src/collection/promotion.ts` (per `contracts/collection-pipeline.md` § promotion.ts) (FR-011, FR-016, FR-018; depends on T008)

**Checkpoint**: User Story 4 is fully functional and independently testable — parsing/enrichment/promotion satisfy SC-007 without needing the scheduler.

---

## Phase 5: User Story 2 - Automatic scheduled collection while running (Priority: P1)

**Goal**: Each enabled subscription automatically checks for new papers on its own interval while the plugin runs, deduplicated and processed sequentially, with `lastCheckedAt` advanced only over what was actually searched, and provider failures surfaced to the user rather than silently swallowed.

**Independent Test**: With a subscription whose interval has elapsed, advance time and confirm a check fires, produces canonical `Paper` data (via T006–T011's stubbed pipeline), and updates the subscription's `lastCheckedAt` — per `quickstart.md`'s dedup and window scenarios. Separately, stub `queryArxiv` to reject and confirm the failure is surfaced to the user and `lastCheckedAt` is left untouched.

### Implementation for User Story 2

- [ ] T012 [P] [US2] Implement the per-run `CollectionRunState` (seen-set + `alreadyPersisted` hook) in `src/collection/dedupe.ts` (per `data-model.md` § Dedup and batch state) (FR-009)
- [ ] T013 [P] [US2] Implement the two-phase `runCollectionPass(candidates, hooks, isSummarizationEnabled, getSemanticScholarApiKey, enrich?)` — `isSummarizationEnabled`/`getSemanticScholarApiKey` are **functions**, called live, never captured booleans/strings (research.md Decision 26, FR-021); `enrich` is an **optional 5th parameter defaulting to `enrichFromSemanticScholar` (T010)** — a dependency-injection seam (research.md Decision 36) so `quickstart.md`/tests can substitute a stub and verify this function's enrichment-apply logic with zero live network calls; production callers (T014, T020) never pass it, relying on the default. **Phase 1 (gather + batch-enrich, research.md Decision 33):** drain the candidate iterable into an array (bounded ≤1,000 by the arXiv cap), drop any candidate already seen/`alreadyPersisted` (FR-009) or failing the year gate (FR-011), then call `enrich(survivors, getSemanticScholarApiKey())` **once** (not a `PipelineHooks` field) to build a `Map<sourceId, EnrichmentOutcome>`. **Phase 2 (sequential per-paper, FR-013):** iterate survivors one at a time, yielding to the event loop, looking up each one's pre-fetched outcome (no per-paper network call) → **apply the outcome to the candidate before promoting**: if `status === 'enriched'`, overwrite the candidate's `citationCount`/`references` with the outcome's values (so `promote`'s `toPaper` derives `citationsKnown = true`); otherwise leave the candidate unchanged (`citationsKnown` stays `false`) — this apply step is required because `enrichFromSemanticScholar` only returns a lookup map, never mutates the candidate itself, and `toPaper` reads citation data off the candidate, not off any separate outcome → promote → if `isSummarizationEnabled()` is `true`, call `hooks.summarize({title, abstract, citationCount, citationsKnown})` (never the full `Paper`, research.md Decision 22) → after it resolves, call `isSummarizationEnabled()` **again**; if now `false`, discard the result (004 FR-009's in-flight-discard, research.md Decision 26) → call `hooks.persist(paper, summarizeResult)` passing whichever summary result (or `undefined`) survives — continuing past any single candidate's summarization/persist failure — in `src/collection/pipeline.ts` (per `contracts/collection-pipeline.md` § pipeline.ts) (FR-009, FR-011, FR-012, FR-013, FR-017, FR-020, FR-021, FR-027; depends on T010, T011, T012)
- [ ] T014 [US2] Implement `runSubscriptionCheck(subscription, window, hooks, isSummarizationEnabled, getSemanticScholarApiKey, enrich?): Promise<{truncated: boolean; coveredThrough: number}>` in `src/collection/pipeline.ts` — the composition point no earlier task built: calls `queryArxiv(subscription, window)` (T006), maps each of its `entries` through `parseArxivEntry` (T008 — **not** `parseArxivAtom`, which expects a whole XML document rather than one already-parsed entry, research.md Decision 25), filtering out any `undefined` result (FR-023) into an `AsyncIterable<PaperCandidate>`, hands that (and its own `isSummarizationEnabled`/`getSemanticScholarApiKey`/`enrich` parameters, forwarded unmodified — `enrich` stays optional/undefined here too, research.md Decision 36) to `runCollectionPass` (T013), and returns `{truncated, coveredThrough}` exactly as `queryArxiv` reported them (FR-026). This is the concrete function `startScheduler`'s `runCheck` dependency wraps (research.md Decision 24) (FR-003, FR-004, FR-007, FR-014, FR-023, FR-026; depends on T006, T008, T013)
- [ ] T015 [US2] Implement `computeCollectionWindow(subscription: Pick<Subscription, 'lastCheckedAt'>, now: number)` — **narrowed to a `Pick`, not the full `Subscription`**, since this function reads only `lastCheckedAt` and `quickstart.md`'s scenarios call it with plain `{ lastCheckedAt }` object literals; typing the parameter as the full `Subscription` would fail those literals under `strict: true` and break `quickstart.md`'s own `tsc --noEmit`-clean prerequisite (per `contracts/collection-pipeline.md` § scheduler.ts) — (`lastCheckedAt` → `now`, or `now - 24h` → `now` when `lastCheckedAt` is null) in `src/collection/scheduler.ts` — this single function is used for BOTH the catch-up pass and every regular tick's window, per Clarification 2026-07-05 § first-collection window; clamp `from = Math.min(lastCheckedAt ?? now - 24h, now)` so a clock that has moved backward past `lastCheckedAt` produces an empty window (`from === to === now`) rather than an inverted range; the `now - 24h` branch is the 24-hour first-window bound (FR-030) (FR-004, FR-024, FR-030, research.md Decision 29)
- [ ] T016 [US2] Implement `startScheduler(plugin, deps)`: a single `plugin.registerInterval(...)`-backed tick, firing every 15 minutes (`SCHEDULER_TICK_INTERVAL_MS`, research.md Decision 4), that on each firing calls `runCheck` for every subscription that is `enabled`, due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`), and not already in the in-flight guard set (`ScheduledCheckState.inFlight: Set<string>`, keyed by `` `${type}:${value}` `` — NOT by `Subscription` object reference, since `getSubscriptions()` may return fresh objects per call — added before calling `runCheck` and removed once it settles, regardless of whether the subscription is later disabled mid-check — research.md Decision 14); due subscriptions within the same tick or catch-up pass MUST be processed one at a time via a sequential `for` loop (`await`ing each `runCheck` before starting the next), never concurrently/via `Promise.all` (FR-022, research.md Decision 27), with each call's `window = computeCollectionWindow(subscription, now)` (T015), then calls `deps.onSubscriptionChecked(subscription, coveredThrough)` only on success — using `runCheck`'s returned `coveredThrough`, NOT `window.to`, so a truncated window advances `lastCheckedAt` only over its covered prefix (FR-026, research.md Decision 32) — and never past the searched window; and **returns a `{ checkNow(subscription): Promise<void> }` handle** (extended to `{ checkNow, backfillNow }` by T027) that runs one subscription through this same window/in-flight/`runCheck` path immediately (a no-op if not `enabled`), for T020 to wire to `subscriptionStore.onRegistered` (FR-028, research.md Decision 34). **This same `checkNow` also satisfies FR-032** (a user-triggered on-demand check of an *existing* subscription) — no separate implementation; only the user-facing trigger differs, and that trigger is 008's per spec Out of Scope. Re-enabling a subscription needs no special case here — its unchanged `lastCheckedAt` makes `computeCollectionWindow` naturally span the disabled period as a catch-up (FR-029, research.md Decision 35). In `src/collection/scheduler.ts` (per `contracts/collection-pipeline.md` § scheduler.ts) (FR-003, FR-005, FR-006, FR-010, FR-022, FR-026, FR-028, FR-029, FR-032, SC-019; depends on T002, T014, T015)
- [ ] T017 [US2] When a subscription's `runCheck` (T016) rejects — e.g. `queryArxiv`/`fetchSemanticScholarPaper` unreachable or erroring — catch it, leave `lastCheckedAt` untouched (relies on T016), and call `deps.onFailure?.(subscription, 'unreachable')` **only if this subscription's `` `${type}:${value}` `` key is not already recorded in a new `ScheduledCheckState.failing: Map<string, 'unreachable' | 'truncated'>` map (alongside the existing `inFlight` set) as `'unreachable'`** — otherwise set/leave that map entry and skip the notice, so a provider down across many retries notifies once, not every 15-minute tick (FR-012a); separately, when `runCheck` resolves with `{truncated: true}` (T014's return value), call `deps.onFailure?.(subscription, 'truncated')` under the same once-per-reason gating (a subscription already marked `'unreachable'` still gets a fresh `'truncated'` notice, since it's a different reason) — while still recording `lastCheckedAt` at the returned `coveredThrough` (T016), so the uncovered tail is picked up next check rather than lost (FR-026, research.md Decision 32). On any `runCheck` that resolves without `truncated: true`, clear that subscription's `failing` entry so a later failure notifies again. `scheduler.ts` itself never imports or constructs a `Notice` here — it only invokes the plain `onFailure` callback (research.md Decision 16); the real `new Notice(...)` implementation is T020's job, kept out of `scheduler.ts` specifically so `quickstart.md` can exercise both call sites with a stubbed `onFailure` outside a real Obsidian host. Additionally implement the **bounded no-progress escape** (FR-026 escape clause): track a per-subscription `ScheduledCheckState.noProgress: Map<string, number>` (same `` `${type}:${value}` `` keying); when a `runCheck` resolves `{truncated: true}` with a `coveredThrough` that does not advance past `window.from` (no forward progress — none of the fetched entries had a readable submission time, per `queryArxiv`'s `window.from` fallback), increment the counter, and once it reaches the module-level constant `MAX_NOPROGRESS_PASSES` (`= 3`) advance `lastCheckedAt` to `window.to` anyway (abandoning the stalled, structurally-unreadable prefix — already unpromotable under FR-023) with a `'truncated'` notice, so the subscription can never re-fetch the same unreadable prefix on every tick forever; reset the counter to 0 on any pass that does make forward progress. Both cases apply identically whether triggered by a regular tick or the catch-up pass (T018 shares this same code path, per research.md Decision 5), so the failure/truncation is retried/re-surfaced on the scheduler's next 15-minute tick rather than silently dropped, in `src/collection/scheduler.ts` (FR-012, FR-012a, FR-014, FR-026; depends on T016)

**Checkpoint**: User Stories 1, 4, and 2 all work independently and together — SC-001, SC-004, SC-005, SC-006 are satisfiable end-to-end with a stubbed provider client.

---

## Phase 6: User Story 3 - Catch-up collection across the off period (Priority: P1)

**Goal**: On plugin load, run exactly one catch-up search per enabled subscription over the window since it was last checked, so no off-period time is permanently lost.

**Independent Test**: Set a subscription's `lastCheckedAt` to the past, invoke the scheduler's load-time entry point, and confirm exactly one catch-up search runs per enabled subscription over the correct window, then `lastCheckedAt` advances to now — per `quickstart.md`'s window scenarios and spec.md's User Story 3 acceptance scenarios.

### Implementation for User Story 3

- [ ] T018 [US3] Extend `startScheduler` to run one catch-up pass over every enabled subscription (using `computeCollectionWindow`, T015) synchronously as part of `startScheduler`'s own execution, before the first recurring tick fires, with no artificial startup delay (research.md Decision 17), sharing the same `inFlight` guard set from T016 so a subscription's catch-up and a subsequent recurring tick can never invoke `runCheck` concurrently for it (research.md Decision 14), in `src/collection/scheduler.ts` (FR-004; depends on T015, T016)
- [ ] T019 [US3] Verify (no new implementation — T017 already implements the shared `onFailure('truncated')` call for both call sites, research.md Decision 5) that the catch-up pass triggers the same `deps.onFailure` call as a regular tick when `runCheck` resolves with `{truncated: true}` for any subscription in the pass, in `src/collection/scheduler.ts` (FR-014; depends on T014, T017, T018)

**Checkpoint**: All four user stories are independently functional — SC-002, SC-003, SC-008 are satisfiable end-to-end.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Repo-wide gates, plugin lifecycle wiring, and the manual validation pass, across the whole feature.

- [ ] T020 Wire `startScheduler(this, { ... })` into `onload` in `src/main.ts`, constructing the full `SchedulerDeps`: `getSubscriptions: () => subscriptionStore.list()`; `onSubscriptionChecked: (subscription, checkedThrough) => subscriptionStore.recordChecked(subscription, checkedThrough)`; `runCheck` as `(subscription, window) => runSubscriptionCheck(subscription, window, pipelineHooks, () => this.settings.summarizationEnabled, () => this.settings.semanticScholarApiKey)` — passing live getters that read through `this.settings` at call time, never a captured `settings.summarizationEnabled`/`settings.semanticScholarApiKey` value snapshotted once at `onload` (FR-021, research.md Decision 26) (T014); and `onFailure: (subscription, reason) => new Notice(...)` — **this is where the real `Notice` construction lives** (research.md Decision 16), never inside `scheduler.ts` itself, with bilingual-ready copy distinguishing the `'unreachable'` and `'truncated'` reasons (constitution Principle V) (constitution Principle II: only via `registerInterval`, no explicit `onunload` stop code needed — this is also what satisfies FR-005/SC-003's "no collection while off," since nothing runs once `registerInterval` is cleaned up on unload); wire `subscriptionStore`'s `load`/`save` as read-modify-write adapters against a single `{ settings: PluginSettings; subscriptions: Subscription[] }` object read/written via `this.loadData()`/`this.saveData()` (research.md Decision 15 — `save` must read the current whole object, replace only `.subscriptions`, and write the whole object back, never overwrite it wholesale); wire `onInvalidData: (droppedCount) => new Notice(...)` so a corrupted/hand-edited persisted subscription list surfaces once to the user rather than silently vanishing (T002); capture the `{ checkNow }` handle returned by `startScheduler` (extended to `{ checkNow, backfillNow }` once US5 lands — the backfill wiring is added in T029, keeping this base wiring independent of backfill) and wire `subscriptionStore`'s `onRegistered` to `(sub) => void scheduler.checkNow(sub)` so a newly-registered subscription is checked immediately (FR-028, research.md Decision 34 — note the wiring order: create the store, then the scheduler whose `getSubscriptions` reads `store.list()`, then set `onRegistered` to the scheduler's `checkNow`); construct `pipelineHooks: PipelineHooks` with `persist`/`summarize`/`alreadyPersisted` sourced from no-op stubs until 003/004 exist and expose their real capabilities — note `alreadyPersisted`/`persist` depend on 003's existence-check/read-back capability (now recorded as 003 FR-015) plus its update-in-place (003 FR-004/FR-008) (research.md Decision 23), which 003 has not yet *implemented*, so these stubs are placeholders until 003 ships that capability, not a temporary simplification of something 003 already provides (FR-005, FR-012, FR-014, FR-020, FR-021, FR-028; depends on T002, T002a, T014, T016, T018)
- [ ] T021 [P] Add README.md and settings-copy-ready disclosure text describing what this feature calls (arXiv, Semantic Scholar), why, that it only runs once a subscription is registered, and that an optional Semantic Scholar API key setting exists purely to grant a dedicated rate limit and is never required (constitution Principle IV; bilingual-ready copy per Principle V; FR-020)
- [ ] T022 [P] Run `npm run build` (`tsc --noEmit` + esbuild) and confirm it passes with all new `src/collection/*.ts` files and the `src/main.ts` + `src/models/settings.ts` changes present (constitution Development Workflow gate)
- [ ] T023 [P] Run `npm run lint` and confirm it introduces no new errors/warnings beyond 001's pre-existing baseline (constitution Development Workflow gate)
- [ ] T024 Execute `quickstart.md` end-to-end: create `scratch/verify-collection.ts`, run it via the documented `esbuild`+`node` steps, confirm every scenario prints `PASS` — including the SC-003 scenario that confirms `startScheduler` registers its recurring tick through `registerInterval` exactly once (never a raw `setInterval` of its own), so Obsidian's automatic `onunload` cleanup is the only thing that ever stops it — there is no separate `stop()` call to invoke, per plan.md's Constitution Check — then `rm -rf scratch/` (depends on T004, T005, T006, T008, T011, T013, T014, T015, T016, T017, T018, T019, T020)

**Note on FR-032 (US6, "check an existing subscription now")**: no implementation task of its own — it is fully satisfied at the data layer by T016's `checkNow` handle (the same one T020 wires to `onRegistered`). The only additional piece is a user-facing trigger for an *existing* subscription, which is 008's responsibility per spec Out of Scope. US6 therefore has no `src/collection/` code beyond what US2 already builds; it is listed as a user story for traceability, satisfied by T016.

---

## Phase 8: User Story 5 - Backfill historical papers on demand (Priority: P3)

**Goal**: Let a user explicitly, per subscription, collect papers *older* than the subscription's forward floor back to a chosen start date — reusing the forward pipeline, without touching `lastCheckedAt`, without duplicates, resumable across the paging cap and plugin restarts, and pausable via disable.

**Independent Test**: Set a subscription's `coveredFrom` to a past instant, call `requestBackfill(sub, olderTargetFrom)`, drive `backfillNow`/ticks, and confirm the `[targetFrom, coveredFrom)` window is covered oldest-first from a stubbed provider, `lastCheckedAt` never changes, forward-collected papers are not re-processed, an over-cap window resumes across passes/restart, and disable pauses / re-enable resumes — per `quickstart.md` § Backfill.

**Note**: This phase is fully additive on top of Phases 1–7 — it can be deferred without affecting the P1/P2 feature. It reuses `runSubscriptionCheck` (T014), the dedup/enrich/promote/persist pipeline (T010–T013), the `inFlight` guard and `onFailure` gating (T016/T017), and 001's `toPaper` — introducing only backfill's own watermarks, window, runner, and wiring.

### Implementation for User Story 5

- [ ] T025 [US5] Add two optional fields to the `Subscription` interface in `src/models/subscription.ts` — `coveredFrom?: number | null` (backward floor) and `backfillState?: { targetFrom: number; cursor: number } | null` (active-backfill progress) — as an FR-016-style additive extension (both optional/absent by default; no existing 001 field removed or redefined), and widen `isValidSubscription` to **accept** them (a subscription without them still validates; when present, `coveredFrom` must be a finite number or null, and `backfillState` must be null or an object with finite `targetFrom`/`cursor`) so persisted subscriptions round-trip whether or not they have ever been backfilled — a cross-feature edit to a 001 file, mirroring the `PluginSettings.semanticScholarApiKey` precedent — in `src/models/subscription.ts` (per `data-model.md` § Subscription backfill state and `research.md` Decision 37) (FR-033, FR-035, FR-036)
- [ ] T026 [US5] Implement `recordFirstCoverage(subscription, from)` (idempotent — sets `coveredFrom = from` only if unset, never raises the floor), `requestBackfill(subscription, targetFrom)` (reject empty/`NaN`/future values; no-op when `targetFrom >= coveredFrom` including unset `coveredFrom`; otherwise set `backfillState = { targetFrom, cursor: targetFrom }` — or lower an in-progress `targetFrom` without rewinding `cursor` — persist, and fire `onBackfillRequested?`), and `recordBackfillProgress(subscription, cursor)` (advance persisted cursor, never backward; on completion `cursor >= coveredFrom` lower `coveredFrom = targetFrom` and clear `backfillState`; no-op if the subscription was deleted, never re-inserting it), plus add `onBackfillRequested?: (subscription) => void` to `SubscriptionStoreDeps` — in `src/collection/subscriptionStore.ts` (per `contracts/collection-pipeline.md` § subscriptionStore.ts and `data-model.md` § Subscription backfill state; `research.md` Decision 37) (FR-033, FR-035, FR-036, FR-037, FR-038, SC-018; depends on T002, T025)
- [ ] T027 [US5] Implement `computeBackfillWindow(subscription): { from: cursor; to: coveredFrom } | undefined` (undefined when no active `backfillState`), call `deps.onFirstCoverage?.(subscription, window.from)` on a subscription's first forward check (its `coveredFrom` still unset) to initialize the backward floor, extend `startScheduler`'s returned handle to `{ checkNow, backfillNow }` where `backfillNow(subscription)` drives `backfill.ts`'s runner **to completion** (looping `runBackfillPass` one pass at a time, `await`ing/yielding between passes, until the `backfillState` clears, the subscription is disabled, or a pass fails — without holding a global lock, so forward ticks for other subscriptions still run between passes), and make the recurring tick + catch-up-on-load pass a safety net that re-arms an interrupted backfill (one pass, then the loop resumes) for any subscription with an active `backfillState`, under the same per-subscription `inFlight` guard so a backfill pass and a forward check for that same subscription never overlap, plus add `onFirstCoverage?`/`onBackfillProgress?` to `SchedulerDeps` — in `src/collection/scheduler.ts` (per `contracts/collection-pipeline.md` § scheduler.ts and `research.md` Decision 37) (FR-035, FR-039; depends on T015, T016, T025)
- [ ] T028 [US5] Implement `runBackfillPass(subscription, deps): Promise<void>` — compute `computeBackfillWindow` (no-op if undefined/empty/disabled), invoke the **same** `runCheck`/`runSubscriptionCheck` (T014) with the backfill window (so discovery/parse/batch-enrich/promote/dedup/summarize/persist and the produced `Paper`/`citationsKnown` are byte-identical to forward collection — FR-034), on a resolved pass advance the cursor to the returned `coveredThrough` via `deps.onBackfillProgress` (reusing FR-026 truncation-aware advancement, so an over-cap window is covered across passes and resumes after restart — FR-036), on rejection leave the cursor unadvanced + surface `onFailure('unreachable')` + retry next tick (FR-040), and on `{truncated: true}` still advance + fire `onFailure('truncated')` (FR-014) — never reading or writing `lastCheckedAt` (FR-035) — in `src/collection/backfill.ts` (per `contracts/collection-pipeline.md` § backfill.ts and `research.md` Decision 37) (FR-034, FR-036, FR-037, FR-040, SC-015, SC-016, SC-017; depends on T014, T027)
- [ ] T029 [US5] Extend `src/main.ts`'s `onload` wiring (T020): capture the now-`{ checkNow, backfillNow }` handle, wire `subscriptionStore.onBackfillRequested` to `(sub) => void scheduler.backfillNow(sub)` (parallel to `onRegistered`→`checkNow`), supply the scheduler's `onFirstCoverage: (sub, from) => subscriptionStore.recordFirstCoverage(sub, from)` and `onBackfillProgress: (sub, cursor) => subscriptionStore.recordBackfillProgress(sub, cursor)` deps, and extend the `onFailure` `Notice` copy to cover the backfill case with bilingual-ready text (constitution Principle V) — in `src/main.ts` (FR-033, FR-035, FR-036, FR-040; depends on T020, T026, T027, T028)
- [ ] T030 [US5] Add `quickstart.md` backfill scenarios (stubbed provider, no live network): a `[targetFrom, coveredFrom)` window is covered oldest-first; `lastCheckedAt` is unchanged before/after (SC-017); a paper the forward pass already stored is deduped, not re-processed; an over-cap window advances monotonically across passes and resumes after a simulated restart (SC-016); a `targetFrom >= coveredFrom` request is a no-op (FR-038); disable pauses and re-enable resumes from the persisted cursor (FR-037) — in `specs/002-subscription-paper-collection/quickstart.md` (SC-015, SC-016, SC-017, SC-018; depends on T026, T027, T028, T029)
- [ ] T031 [US5] Re-run `npm run build` (`tsc --noEmit` + esbuild) and `npm run lint` with the backfill files/fields present, and execute the new `quickstart.md` backfill scenarios end-to-end confirming each prints `PASS` (constitution Development Workflow gate; depends on T025, T026, T027, T028, T029, T030)

**Checkpoint**: Backfill is fully functional and independently testable on top of the P1/P2 feature — SC-015, SC-016, SC-017, SC-018 are satisfiable end-to-end with a stubbed provider.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 only. Blocks all user story phases (T002 blocks US1/US2/US3; T003's shared types are used by US4/US2; T002a's settings field blocks T020 in Polish).
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T002). Independently testable in isolation.
- **User Story 4 (Phase 4)**: Depends on Phase 2 (T003) only — does not depend on US1. Independently testable in isolation.
- **User Story 2 (Phase 5)**: Depends on Phase 2 (T002) and Phase 4 (T006, T008, T010, T011) for a working pipeline to schedule.
- **User Story 3 (Phase 6)**: Depends on Phase 5 (T015, T016) — catch-up reuses the scheduler's window/tick machinery.
- **Polish (Phase 7)**: T020 depends on T002 (US1) and US2+US3 (T014, T016, T018); T022–T024 depend on all prior phases being present.
- **User Story 5 (Phase 8)**: Depends on Phase 4 (T014 pipeline), Phase 5 (T015/T016 scheduler), and Phase 7 (T020 base main.ts wiring). Fully additive — the P1/P2 feature ships without it. US6 (check-now) has no phase of its own; it is satisfied by T016 (see the note above Phase 8).

### Within Each User Story

- US1: T004 → T005 (same file, sequential)
- US4: {T006, T007, T008, T009} in parallel → T010 (depends on T007, T009) → T011 (depends on T008)
- US2: {T012, T013} in parallel (T013 also depends on US4's T010/T011) → T014 (depends on T006, T008, T013) → T015 → T016 (depends on T002, T014, T015) → T017 (depends on T016)
- US3: T018 (depends on T015, T016) → T019 (depends on T014, T017, T018)
- US5: T025 → T026 (depends on T002, T025) → T027 (depends on T015, T016, T025) → T028 (depends on T014, T027) → T029 (depends on T020, T026, T027, T028) → T030 (depends on T026, T027, T028, T029) → T031 (depends on all US5)

### Parallel Opportunities

- T002, T002a, and T003 can start together immediately after T001 (three different files — `subscriptionStore.ts`, `settings.ts`, `types.ts`).
- T006, T007, T008, T009 (US4) can all start together once T003 is done — four different files, no cross-task dependency until T010/T011.
- T012 (US2) can start as soon as T003 is done, in parallel with all of US4's tasks.
- T021, T022, T023 (Polish) can run together once the rest of the feature is implemented.

---

## Parallel Example: Kicking off Foundational and User Story 4 together

```bash
# After T001 (Setup) completes:
Task: "Implement createSubscriptionStore in src/collection/subscriptionStore.ts"
Task: "Define shared collection types in src/collection/types.ts"
# Once types.ts (T003) is done, all of these can start together:
Task: "Implement queryArxiv in src/collection/arxivClient.ts"
Task: "Implement fetchSemanticScholarPaper in src/collection/semanticScholarClient.ts"
Task: "Implement parseArxivEntry (and the parseArxivAtom convenience wrapper) in src/collection/arxivParser.ts"
Task: "Implement the Semantic Scholar citation-field mapper in src/collection/semanticScholarParser.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002, T002a, T003)
3. Complete Phase 3: User Story 1 (T004–T005)
4. **STOP and VALIDATE**: run `npm run build` and manually exercise `subscriptionStore.ts` per `quickstart.md`'s Subscription management scenarios
5. `subscriptionStore.ts` alone already gives 008's future settings UI something to call, and is usable standalone even before any provider integration exists

### Incremental Delivery

1. Setup → Foundational (subscription storage + shared types) ready
2. Add User Story 1 (subscription management) → validate independently → MVP
3. Add User Story 4 (provider parsing & enrichment) → validate independently (no scheduler needed)
4. Add User Story 2 (scheduled collection, including failure notification and the `runSubscriptionCheck` composition) → validate independently (ties US1 storage + US4 pipeline together via the scheduler)
5. Add User Story 3 (catch-up collection) → validate independently (extends US2's scheduler)
6. Polish: plugin wiring, disclosure copy, full build/lint/quickstart pass

### Parallel Team Strategy

With multiple developers: after T001–T003, one person takes US1 (`subscriptionStore.ts` CRUD), one takes US4 (the four parser/client/enrichment/promotion files), and once both land, a third takes US2+US3 (`dedupe.ts`, `pipeline.ts`, `scheduler.ts`), which is the only phase that depends on both of the others.

---

## Notes

- [P] tasks touch different files with no dependency on an incomplete task.
- [Story] labels map every implementation task back to its `spec.md` user story for traceability.
- No test tasks are included — see the "Tests" note at the top of this file.
- Every task traces to a specific FR-/SC- number from `spec.md`; the Clarifications from the 2026-07-05 session (first-collection window, provider routing, scheduling, identity matching, sourceId scheme), the 2026-07-06 session (arXiv-ID-only matching, sourceId version-stripping, in-flight guard, shared-storage read-modify-write), and the 2026-07-06 (continued) session (FR-021 settings freshness/in-flight discard, FR-022 sequential subscription checking, FR-023 malformed-entry skip, FR-024 clock-backward clamp, FR-025 empty-value rejection, FR-026 submittedDate-ascending sort + truncation covers-not-loses via `coveredThrough`, FR-027 batched Semantic Scholar enrichment, FR-028 immediate check on new registration, FR-029 re-enable keeps catch-up semantics), and the 2026-07-07 session (FR-024 clock-backward leaves `lastCheckedAt` unchanged, FR-026 bounded no-progress escape, FR-030 24h first-window bound, FR-031 arXiv-sole-discovery routing, FR-032 on-demand check, FR-033–040 backfill) are cited directly where they drove a specific implementation choice (T002/T004/T006/T007/T008/T009/T010/T013/T014/T015/T016/T017/T018/T019/T020/T025/T026/T027/T028/T029).
- Where a task relies on 001's own rules (e.g. `assignCheckInterval`'s rejection behavior in T002/T005), the citation points to 001, not to one of this spec's 40 FRs — 002 has no FR of its own for that specific rejection rule, only for exposing the ability to change an interval at all (FR-002).
- T014 (`runSubscriptionCheck`) and T020's stub `PipelineHooks` are a deliberate seam (research.md Decision 10) — swapping the stubs for real 003/004 calls is a future feature's task, not this one's, per spec.md's Out of Scope; `runSubscriptionCheck` itself does not change.
- Commit after each task or logical group (per this repo's usual workflow).
- Stop at any checkpoint to validate a story independently before moving on.
