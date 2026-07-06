---

description: "Task list for Subscription-Based Paper Collection"
---

# Tasks: Subscription-Based Paper Collection

**Input**: Design documents from `/specs/002-subscription-paper-collection/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/collection-pipeline.md

**Tests**: Not explicitly requested in `spec.md`. `plan.md`/`research.md` follow 001's precedent of no test framework in this repo. Correctness relies on `tsc --noEmit`, `eslint .`, and the manual `quickstart.md` walkthrough (stubbed provider responses, no live network) — see the Polish phase.

**Organization**: Tasks are grouped by user story (Subscription management = P1/US1, Scheduled collection = P1/US2, Catch-up collection = P1/US3, Provider parsing & enrichment = P2/US4, per `spec.md`) so each can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Every description includes the exact file path

## Path Conventions

Single project (this repo is one Obsidian plugin bundle, no frontend/backend split). All new files live under `src/collection/`, per `plan.md`'s Project Structure. `src/main.ts` is touched by exactly one task (Polish phase, scheduler wiring); no other existing file is modified.

---

## Phase 1: Setup

**Purpose**: Confirm a clean baseline before adding new files.

- [ ] T001 Create the `src/collection/` directory and confirm `npm run build` and `npm run lint` both still pass on the unmodified baseline (with 001's `src/models/` already present), so any later failure is known to come from this feature's new code

**Checkpoint**: Baseline confirmed clean — safe to start adding collection modules.

---

## Phase 2: Foundational

**Purpose**: Blocking prerequisites shared by more than one user story — everything scheduled/catch-up collection (US2/US3) needs to read and update subscriptions, which is also this feature's own US1 concern, so the storage layer goes first.

- [ ] T002 [P] Implement `subscriptionStore.ts`'s `createSubscriptionStore(deps)` with `list()`, `register()`, `remove()`, `setEnabled()`, `setCheckInterval()` (delegating to 001's `assignCheckInterval`, per 001's own FR-005 rejection rule — reused here, not one of this spec's FRs), and `recordChecked()`, where `deps` includes an optional `onRegistered?: (subscription) => void` callback (fired by `register` only on genuinely-new registration, wired to the scheduler's `checkNow` by T020 — FR-028, research.md Decision 34) in `src/collection/subscriptionStore.ts` (per `contracts/collection-pipeline.md` § subscriptionStore.ts and `data-model.md` § Subscription store) (FR-001, FR-002, FR-006, FR-010)
- [ ] T003 [P] Define the shared in-memory intermediate types (`CollectionWindow`, `ArxivEntry`, `SemanticScholarPaper`, `SemanticScholarReference`, `EnrichmentOutcome`, `CollectionRunState`, `PipelineHooks`) in a small shared types module `src/collection/types.ts` (per `data-model.md`), including a shared `stripArxivVersion(rawId: string): string` helper (strips a trailing `vN` suffix) so `arxivParser.ts` (T008) and `semanticScholarParser.ts` (T009) both normalize arXiv IDs the exact same way (research.md Decision 9/13) without depending on each other

**Checkpoint**: Subscription storage and shared types exist — US1 can be validated standalone; US2/US3/US4 have what they need to build on.

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

- [ ] T006 [P] [US4] Implement `buildArxivSearchUrl(subscription, window, page)` as a pure, network-free function — stripping literal `"` from `subscription.value` before building the type-specific `search_query` clause, combining it with `submittedDate:[from TO to]` formatted via UTC-based `Date` accessors only (never local-timezone accessors — research.md Decision 19), `encodeURIComponent`-encoding the assembled query string (research.md Decision 18), and appending the fixed ordering params `&sortBy=submittedDate&sortOrder=ascending` (never arXiv's default relevance sort — FR-026, research.md Decision 32) — then implement `queryArxiv(subscription, window)` using `requestUrl` and `buildArxivSearchUrl`, paging via `start`/`max_results=100` up to a 10-page (1,000-entry) safety cap with a 3-second delay between page requests, parsing each page's response with `DOMParser` itself (no dependency on `arxivParser.ts` — research.md Decision 25) to extract and count `<entry>` nodes for the pagination check, returning those `Element[]` entries plus a `truncated` flag when the cap is hit **and** a `coveredThrough` epoch-ms value — `window.to` when fully covered, else the `<published>` time of the last (newest, since ascending) entry fetched; if that newest entry's `<published>` is missing/unparseable, scan backward among fetched entries for the first one with a valid `<published>`, and if none exists at all, fall back to `window.from` (never `NaN`/thrown, since this feeds the persisted `lastCheckedAt`) (FR-026, research.md Decision 32) — in `src/collection/arxivClient.ts` (per `contracts/collection-pipeline.md` § arxivClient.ts and `research.md` Decisions 11, 18, 19, 25, 32) (FR-008, FR-014, FR-026)
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
- [ ] T013 [P] [US2] Implement the two-phase `runCollectionPass(candidates, hooks, isSummarizationEnabled, getSemanticScholarApiKey)` — the last two taking **functions**, called live, never captured booleans/strings (research.md Decision 26, FR-021). **Phase 1 (gather + batch-enrich, research.md Decision 33):** drain the candidate iterable into an array (bounded ≤1,000 by the arXiv cap), drop any candidate already seen/`alreadyPersisted` (FR-009) or failing the year gate (FR-011), then call `enrichFromSemanticScholar(survivors, getSemanticScholarApiKey())` (T010) **once** (not a `PipelineHooks` field) to build a `Map<sourceId, EnrichmentOutcome>`. **Phase 2 (sequential per-paper, FR-013):** iterate survivors one at a time, yielding to the event loop, looking up each one's pre-fetched outcome (no per-paper network call) → promote → if `isSummarizationEnabled()` is `true`, call `hooks.summarize({title, abstract, citationCount, citationsKnown})` (never the full `Paper`, research.md Decision 22) → after it resolves, call `isSummarizationEnabled()` **again**; if now `false`, discard the result (004 FR-009's in-flight-discard, research.md Decision 26) → call `hooks.persist(paper, summarizeResult)` passing whichever summary result (or `undefined`) survives — continuing past any single candidate's summarization/persist failure — in `src/collection/pipeline.ts` (per `contracts/collection-pipeline.md` § pipeline.ts) (FR-009, FR-011, FR-012, FR-013, FR-017, FR-020, FR-021, FR-027; depends on T010, T011, T012)
- [ ] T014 [US2] Implement `runSubscriptionCheck(subscription, window, hooks, isSummarizationEnabled, getSemanticScholarApiKey): Promise<{truncated: boolean; coveredThrough: number}>` in `src/collection/pipeline.ts` — the composition point no earlier task built: calls `queryArxiv(subscription, window)` (T006), maps each of its `entries` through `parseArxivEntry` (T008 — **not** `parseArxivAtom`, which expects a whole XML document rather than one already-parsed entry, research.md Decision 25), filtering out any `undefined` result (FR-023) into an `AsyncIterable<PaperCandidate>`, hands that (and its own `isSummarizationEnabled`/`getSemanticScholarApiKey` parameters, forwarded unmodified) to `runCollectionPass` (T013), and returns `{truncated, coveredThrough}` exactly as `queryArxiv` reported them (FR-026). This is the concrete function `startScheduler`'s `runCheck` dependency wraps (research.md Decision 24) (FR-003, FR-004, FR-007, FR-014, FR-023, FR-026; depends on T006, T008, T013)
- [ ] T015 [US2] Implement `computeCollectionWindow(subscription, now)` (`lastCheckedAt` → `now`, or `now - 24h` → `now` when `lastCheckedAt` is null) in `src/collection/scheduler.ts` — this single function is used for BOTH the catch-up pass and every regular tick's window, per Clarification 2026-07-05 § first-collection window; clamp `from = Math.min(lastCheckedAt ?? now - 24h, now)` so a clock that has moved backward past `lastCheckedAt` produces an empty window (`from === to === now`) rather than an inverted range (FR-004, FR-024, research.md Decision 29)
- [ ] T016 [US2] Implement `startScheduler(plugin, deps)`: a single `plugin.registerInterval(...)`-backed tick, firing every 15 minutes (`SCHEDULER_TICK_INTERVAL_MS`, research.md Decision 4), that on each firing calls `runCheck` for every subscription that is `enabled`, due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`), and not already in the in-flight guard set (`ScheduledCheckState.inFlight: Set<string>`, keyed by `` `${type}:${value}` `` — NOT by `Subscription` object reference, since `getSubscriptions()` may return fresh objects per call — added before calling `runCheck` and removed once it settles, regardless of whether the subscription is later disabled mid-check — research.md Decision 14); due subscriptions within the same tick or catch-up pass MUST be processed one at a time via a sequential `for` loop (`await`ing each `runCheck` before starting the next), never concurrently/via `Promise.all` (FR-022, research.md Decision 27), with each call's `window = computeCollectionWindow(subscription, now)` (T015), then calls `deps.onSubscriptionChecked(subscription, coveredThrough)` only on success — using `runCheck`'s returned `coveredThrough`, NOT `window.to`, so a truncated window advances `lastCheckedAt` only over its covered prefix (FR-026, research.md Decision 32) — and never past the searched window; and **returns a `{ checkNow(subscription): Promise<void> }` handle** that runs one subscription through this same window/in-flight/`runCheck` path immediately (a no-op if not `enabled`), for T020 to wire to `subscriptionStore.onRegistered` (FR-028, research.md Decision 34). Re-enabling a subscription needs no special case here — its unchanged `lastCheckedAt` makes `computeCollectionWindow` naturally span the disabled period as a catch-up (FR-029, research.md Decision 35). In `src/collection/scheduler.ts` (per `contracts/collection-pipeline.md` § scheduler.ts) (FR-003, FR-005, FR-006, FR-010, FR-022, FR-026, FR-028, FR-029; depends on T002, T014, T015)
- [ ] T017 [US2] When a subscription's `runCheck` (T016) rejects — e.g. `queryArxiv`/`fetchSemanticScholarPaper` unreachable or erroring — catch it, leave `lastCheckedAt` untouched (relies on T016), and call `deps.onFailure?.(subscription, 'unreachable')`; separately, when `runCheck` resolves with `{truncated: true}` (T014's return value), call `deps.onFailure?.(subscription, 'truncated')` instead — while still recording `lastCheckedAt` at the returned `coveredThrough` (T016), so the uncovered tail is picked up next check rather than lost (FR-026, research.md Decision 32). `scheduler.ts` itself never imports or constructs a `Notice` here — it only invokes the plain `onFailure` callback (research.md Decision 16); the real `new Notice(...)` implementation is T020's job, kept out of `scheduler.ts` specifically so `quickstart.md` can exercise both call sites with a stubbed `onFailure` outside a real Obsidian host. Both cases apply identically whether triggered by a regular tick or the catch-up pass (T018 shares this same code path, per research.md Decision 5), so the failure/truncation is retried/re-surfaced on the next scheduled interval/load rather than silently dropped, in `src/collection/scheduler.ts` (FR-012, FR-014, FR-026; depends on T016)

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

- [ ] T020 Wire `startScheduler(this, { ... })` into `onload` in `src/main.ts`, constructing the full `SchedulerDeps`: `getSubscriptions: () => subscriptionStore.list()`; `onSubscriptionChecked: (subscription, checkedThrough) => subscriptionStore.recordChecked(subscription, checkedThrough)`; `runCheck` as `(subscription, window) => runSubscriptionCheck(subscription, window, pipelineHooks, () => this.settings.summarizationEnabled, () => this.settings.semanticScholarApiKey)` — passing live getters that read through `this.settings` at call time, never a captured `settings.summarizationEnabled`/`settings.semanticScholarApiKey` value snapshotted once at `onload` (FR-021, research.md Decision 26) (T014); and `onFailure: (subscription, reason) => new Notice(...)` — **this is where the real `Notice` construction lives** (research.md Decision 16), never inside `scheduler.ts` itself, with bilingual-ready copy distinguishing the `'unreachable'` and `'truncated'` reasons (constitution Principle V) (constitution Principle II: only via `registerInterval`, no explicit `onunload` stop code needed — this is also what satisfies FR-005/SC-003's "no collection while off," since nothing runs once `registerInterval` is cleaned up on unload); wire `subscriptionStore`'s `load`/`save` as read-modify-write adapters against a single `{ settings: PluginSettings; subscriptions: Subscription[] }` object read/written via `this.loadData()`/`this.saveData()` (research.md Decision 15 — `save` must read the current whole object, replace only `.subscriptions`, and write the whole object back, never overwrite it wholesale); capture the `{ checkNow }` handle returned by `startScheduler` and wire `subscriptionStore`'s `onRegistered` to `(sub) => void scheduler.checkNow(sub)` so a newly-registered subscription is checked immediately (FR-028, research.md Decision 34 — note the wiring order: create the store, then the scheduler whose `getSubscriptions` reads `store.list()`, then set `onRegistered` to the scheduler's `checkNow`); construct `pipelineHooks: PipelineHooks` with `persist`/`summarize`/`alreadyPersisted` sourced from no-op stubs until 003/004 exist and expose their real capabilities — note `alreadyPersisted`/`persist` depend on 003's existence-check/read-back capability (now recorded as 003 FR-015) plus its update-in-place (003 FR-004/FR-008) (research.md Decision 23), which 003 has not yet *implemented*, so these stubs are placeholders until 003 ships that capability, not a temporary simplification of something 003 already provides (FR-005, FR-012, FR-014, FR-020, FR-021, FR-028; depends on T002, T014, T016, T018)
- [ ] T021 [P] Add README.md and settings-copy-ready disclosure text describing what this feature calls (arXiv, Semantic Scholar), why, that it only runs once a subscription is registered, and that an optional Semantic Scholar API key setting exists purely to grant a dedicated rate limit and is never required (constitution Principle IV; bilingual-ready copy per Principle V; FR-020)
- [ ] T022 [P] Run `npm run build` (`tsc --noEmit` + esbuild) and confirm it passes with all new `src/collection/*.ts` files and the `src/main.ts` change present (constitution Development Workflow gate)
- [ ] T023 [P] Run `npm run lint` and confirm it introduces no new errors/warnings beyond 001's pre-existing baseline (constitution Development Workflow gate)
- [ ] T024 Execute `quickstart.md` end-to-end: create `scratch/verify-collection.ts`, run it via the documented `esbuild`+`node` steps, confirm every scenario prints `PASS` — including a scenario that stops the scheduler and asserts no further `runCheck` fires afterward (SC-003) — then `rm -rf scratch/` (depends on T004, T005, T006, T008, T011, T013, T014, T015, T016, T017, T018, T019, T020)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Phase 1 only. Blocks all user story phases (T002 blocks US1/US2/US3; T003's shared types are used by US4/US2).
- **User Story 1 (Phase 3)**: Depends on Phase 2 (T002). Independently testable in isolation.
- **User Story 4 (Phase 4)**: Depends on Phase 2 (T003) only — does not depend on US1. Independently testable in isolation.
- **User Story 2 (Phase 5)**: Depends on Phase 2 (T002) and Phase 4 (T006, T008, T010, T011) for a working pipeline to schedule.
- **User Story 3 (Phase 6)**: Depends on Phase 5 (T015, T016) — catch-up reuses the scheduler's window/tick machinery.
- **Polish (Phase 7)**: T020 depends on T002 (US1) and US2+US3 (T014, T016, T018); T022–T024 depend on all prior phases being present.

### Within Each User Story

- US1: T004 → T005 (same file, sequential)
- US4: {T006, T007, T008, T009} in parallel → T010 (depends on T007, T009) → T011 (depends on T008)
- US2: {T012, T013} in parallel (T013 also depends on US4's T010/T011) → T014 (depends on T006, T008, T013) → T015 → T016 (depends on T002, T014, T015) → T017 (depends on T016)
- US3: T018 (depends on T015, T016) → T019 (depends on T014, T017, T018)

### Parallel Opportunities

- T002 and T003 can start together immediately after T001.
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
2. Complete Phase 2: Foundational (T002, T003)
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
- Every task traces to a specific FR-/SC- number from `spec.md`; the Clarifications from the 2026-07-05 session (first-collection window, provider routing, scheduling, identity matching, sourceId scheme), the 2026-07-06 session (arXiv-ID-only matching, sourceId version-stripping, in-flight guard, shared-storage read-modify-write), and the 2026-07-06 (continued) session (FR-021 settings freshness/in-flight discard, FR-022 sequential subscription checking, FR-023 malformed-entry skip, FR-024 clock-backward clamp, FR-025 empty-value rejection, FR-026 submittedDate-ascending sort + truncation covers-not-loses via `coveredThrough`, FR-027 batched Semantic Scholar enrichment, FR-028 immediate check on new registration, FR-029 re-enable keeps catch-up semantics) are cited directly where they drove a specific implementation choice (T002/T004/T006/T007/T008/T009/T010/T013/T014/T015/T016/T017/T018/T019/T020).
- Where a task relies on 001's own rules (e.g. `assignCheckInterval`'s rejection behavior in T002/T005), the citation points to 001, not to one of this spec's 20 FRs — 002 has no FR of its own for that specific rejection rule, only for exposing the ability to change an interval at all (FR-002).
- T014 (`runSubscriptionCheck`) and T020's stub `PipelineHooks` are a deliberate seam (research.md Decision 10) — swapping the stubs for real 003/004 calls is a future feature's task, not this one's, per spec.md's Out of Scope; `runSubscriptionCheck` itself does not change.
- Commit after each task or logical group (per this repo's usual workflow).
- Stop at any checkpoint to validate a story independently before moving on.
