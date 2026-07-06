# Phase 0 Research: Subscription-Based Paper Collection

All `[NEEDS CLARIFICATION]` items from the spec were already resolved during `/speckit-clarify` (see `spec.md` § Clarifications: first-collection window, provider routing, scheduling mechanism, identity matching, `sourceId` normalization). The research below covers the remaining *technical* decisions needed to turn those resolved business rules into a concrete design against this repo's actual `src/models/` types (001) and the Obsidian plugin platform.

## 1. Making network calls from an Obsidian plugin

**Decision**: Use Obsidian's `requestUrl(options)` (exported by the `obsidian` package) for both the arXiv and Semantic Scholar HTTP calls, never the global `fetch` or a Node HTTP client.

**Rationale**: `requestUrl` is Obsidian's own cross-platform HTTP primitive — it works unchanged on desktop and mobile and, critically, is not subject to the CORS restrictions that block a plain `fetch` call to most third-party APIs from within Obsidian's renderer. Node's `http`/`https` modules would violate constitution Principle I (mobile-compatible-by-default; Node/Electron-only APIs require `isDesktopOnly`), which this feature has no reason to set.

**Alternatives considered**:
- *Global `fetch`*: rejected — frequently blocked by CORS inside Obsidian's Electron/Capacitor webview for arbitrary third-party origins; `requestUrl` exists specifically to route around this.
- *Node `https` module*: rejected — desktop-only, forces `isDesktopOnly: true` on the whole plugin, contradicting the mobile-compatibility goal already established by 001/the constitution.

## 2. Parsing arXiv's Atom XML response

**Decision**: Parse the raw XML string returned by `requestUrl` with the standard `DOMParser` (`new DOMParser().parseFromString(xml, 'application/xml')`), then walk `<entry>` elements to build one `PaperCandidate` per entry (title, authors from repeated `<author><name>`, publication year from `<published>`, abstract from `<summary>`, `sourceId` built from the arXiv id URL, `citationCount`/`references` left `undefined`).

**Rationale**: `DOMParser` is a standard Web API available in both the desktop (Chromium/Electron) and mobile (Capacitor WebView) Obsidian runtimes — no new dependency, and it handles Atom's XML namespaces and repeated-element structure (multiple `<author>` per `<entry>`) more robustly than regex/string scanning. This keeps the parser file free of any XML library dependency, matching 001's "no new runtime dependency" precedent.

**Alternatives considered**:
- *A dedicated XML/Atom parsing npm package (e.g. `fast-xml-parser`)*: rejected for v1 — adds a bundled dependency for a format `DOMParser` already handles natively; revisit only if `DOMParser`'s namespace handling proves insufficient in practice.
- *Regex-based extraction*: rejected — Atom entries have nested/repeated elements (multiple authors, multiple links) that regex handles unreliably compared to real DOM traversal.

## 3. Parsing Semantic Scholar's JSON response

**Decision**: `requestUrl`'s response body is parsed with `JSON.parse` (or Obsidian's already-parsed `.json` accessor) directly into a typed intermediate shape, then mapped into the citation fields (`citationCount`, `references` with each reference's `sourceId` normalized per Decision 7 below) merged onto an existing `PaperCandidate` during enrichment, or into a fresh one if Semantic Scholar is ever used to build a candidate from scratch (not needed under the "arXiv-only discovery" clarification, but the mapping function stays provider-agnostic so it isn't wasted if that changes later).

**Rationale**: JSON needs no special parsing library; the only design decision is keeping the field-mapping (Semantic Scholar's `paperId`/`citationCount`/`references[].externalIds.ArXiv` etc.) isolated in its own module (`semanticScholarParser.ts`) so a future Semantic Scholar API schema change touches one file.

**Alternatives considered**: None materially different — this is a standard JSON-to-typed-object mapping with no ambiguity worth exploring alternatives for.

## 4. Scheduling per-subscription checks without leaking timers

**Decision**: A `scheduler.ts` module exposes `start(plugin: Plugin, subscriptions: () => Subscription[], onDue: (sub) => Promise<void>)` and relies entirely on `plugin.registerInterval(window.setInterval(...))` for the recurring tick — firing every **15 minutes**, a single coarse interval that on each tick checks which enabled subscriptions are now due, rather than one JS timer per subscription. `onload` calls `start(...)` once; because it is registered via `registerInterval`, `onunload` cleanup is automatic and requires no explicit `stop()` bookkeeping.

**Rationale**: Constitution Principle II (NON-NEGOTIABLE) prohibits raw `setInterval` outside `this.registerInterval(...)`. A single coarse recurring tick that re-evaluates all subscriptions' due-times is simpler and leak-proof compared to creating/destroying one OS/JS timer per subscription as subscriptions are added, deleted, or have their interval changed — that approach would require careful teardown bookkeeping (a map of subscription id → timer handle, cleared on delete/interval-change) that is easy to get subtly wrong. The "per-subscription timer" language in the spec's clarification refers to each subscription tracking its *own next-check time* (derived from its own `checkIntervalHours` and `lastCheckedAt`), not to one OS timer object per subscription — a single tick loop that compares "is `now >= lastCheckedAt + checkIntervalHours` for this subscription" achieves exactly that independence of cadence with one registered interval to clean up. **15 minutes** (pinned 2026-07-06, superseding the earlier "every few minutes" placeholder) is chosen because the allowed check intervals are whole hours (6/12/24/48/72) — a 15-minute polling granularity bounds how late a due check can fire to at most ~15 minutes past its exact due time, under 4% of even the shortest allowed interval, while not waking the plugin needlessly often on mobile/battery-constrained devices.

**Alternatives considered**:
- *One `registerInterval` per subscription*: rejected — every subscription add/delete/interval-change would need to create/clear its own timer handle, multiplying the surface for a lifecycle leak that Principle II explicitly calls out as NON-NEGOTIABLE; a single recurring tick sidesteps this entirely.
- *`setTimeout` chains re-armed after each check*: rejected — same per-subscription teardown bookkeeping problem, plus `setTimeout` still needs the same `register*` wrapper treatment and gains nothing over one shared interval.
- *A shorter tick (e.g. 1-5 minutes)*: rejected — no measurable benefit given hour-granularity check intervals, at the cost of waking the plugin roughly 3-15x more often for no user-visible improvement in promptness.
- *A longer tick (e.g. 1 hour)*: rejected — would let a due check slip by up to an hour past its due time, a visible fraction (up to ~17%) of the shortest allowed 6-hour interval.

## 5. Catch-up-on-load computation

**Decision**: On `onload`, before starting the recurring tick, the scheduler runs one pass over all enabled subscriptions: for each, if `lastCheckedAt` is not null, the catch-up window is `[lastCheckedAt, now]`; if `lastCheckedAt` is null (brand-new subscription), the window is `[now - 24h, now]` per the clarified first-collection default. Each subscription's catch-up search reuses the exact same "check" code path as a normal scheduled tick (same provider query, same candidate/enrichment/promotion/dedupe/batch pipeline), parameterized only by the window bounds — there is no separate "catch-up" implementation to keep in sync with the "live tick" implementation.

**Rationale**: Directly implements FR-004 or the *equivalent* case at plugin start, keeps `scheduler.ts` as the single owner of "when do we check and over what window" (FR-006's "advance `lastCheckedAt` only over the window actually searched" is easiest to get right with one code path), and satisfies the first-collection-window clarification without a second, divergent implementation.

**Alternatives considered**: A separate one-shot "catch-up service" module distinct from the scheduler's tick handler — rejected as needless duplication; the window-bounds parameterization already covers both cases from one function.

## 6. Sequential, non-freezing batch processing

**Decision**: `batchQueue.ts` processes a batch of discovered provider entries one at a time using `for (const entry of batch) { await processOne(entry); }`, where `processOne` is itself `async` (network calls for enrichment are naturally awaited) and — for a purely-CPU-bound stretch with no natural `await` (e.g. many `PaperCandidate`s already in memory with citation data, so no further network call is needed before promotion) — the loop yields to the event loop between items via `await new Promise(resolve => setTimeout(resolve, 0))` so a large batch can't block Obsidian's UI thread in one synchronous tick.

**Rationale**: Directly implements FR-013/Edge Cases ("processed sequentially without freezing the interface"). `async`/`await` in a `for...of` loop is the simplest construct that is both sequential (papers are handed to 003/004 one at a time — no accidental concurrent double-persist of the same paper) and non-blocking (each iteration returns control to the event loop), with the explicit zero-delay `setTimeout` yield covering the edge case where an item's processing has no `await` of its own.

**Alternatives considered**:
- *`Promise.all` over the whole batch*: rejected — the spec's "processed sequentially" language and FR-013 explicitly call for one-at-a-time, non-concurrent handling (also avoids simultaneously blasting the persistence layer with concurrent writes for papers that could collide on filenames).
- *A Web Worker*: rejected as unnecessary complexity — none of the per-paper work is CPU-heavy enough (XML/JSON parsing of one entry, a couple of network calls) to need moving off the main thread; a worker would also complicate `requestUrl` usage (an Obsidian API, not necessarily available identically inside a worker context) for no measurable benefit.

## 7. Citation enrichment: identity matching and termination

**Decision**: `enrichment.ts` matches a candidate to its Semantic Scholar record **by arXiv ID only** (`GET /graph/v1/paper/ARXIV:<id>`), which Semantic Scholar's API supports directly. There is **no title/author fallback**. A `404` (no record for that arXiv ID) is classified as a **terminal absence** — enrichment stops for that paper on this pass, `citationsKnown` stays `false`, and it is not retried by this feature again (only 005's manual refresh or a future auto-heal may retry it later, per FR-018). A genuine transient failure (network error, 5xx, rate-limit/`429` response) is retried up to a small bounded count (3 attempts, 3-second spacing) within the same pass before falling through to the same `citationsKnown = false` outcome.

**Rationale (revised 2026-07-06, spec Clarification session 2026-07-06)**: An earlier version of this decision fell back to a title+first-author search when the arXiv-ID lookup found no match. That fallback was removed because a title/author relevance search can rank an unrelated paper by an author with a common surname above the correct one, and accepting that top result would silently attach the *wrong* paper's citation count/references — a worse outcome than the correct one (an honest `citationsKnown = false`) that the fallback was meant to avoid. Matching by arXiv ID only accepts a higher terminal-absence rate (a real, recent arXiv paper simply not yet indexed by Semantic Scholar) in exchange for zero risk of a false-positive match silently corrupting citation data.

**Alternatives considered**:
- *DOI-based matching*: rejected as primary — arXiv preprints frequently lack a registered DOI at collection time; arXiv-ID matching is more universally available for this feature's actual inputs (arXiv-discovered candidates).
- *Unbounded retry until success*: rejected — directly contradicts FR-018's explicit bounded-retry requirement and would risk an unresponsive provider stalling collection indefinitely.
- *Keep the title+author fallback but require a higher-confidence match (e.g. exact title string match, not just top relevance result)*: considered, but still not zero-risk (two distinct papers can legitimately share a title), and adds meaningful implementation complexity for a benefit (fewer terminal-absence outcomes) that this project decided not to trade safety for.

## 8. Deduplication across subscriptions and overlapping windows

**Decision**: A single per-`onDue`-invocation (and per-catch-up-pass) `Set<PaperSourceId>` is threaded through `dedupe.ts`: before a discovered entry is handed to the enrichment/promotion pipeline, its `sourceId` is checked against (a) the in-memory set for entries already processed in this same collection run, and (b) a hand-off hook to 003 for "does a record with this `sourceId` already exist in the persisted store" (needed because two *different* scheduled ticks, not just two subscriptions in the same tick, can discover the same already-stored paper). Either match short-circuits further processing for that entry.

**Rationale**: FR-009/SC-004 require exactly-once processing regardless of whether the duplicate arises from two subscriptions in the same run or overlapping catch-up windows across separate runs. Checking only the in-memory set would miss the cross-run case (e.g., paper already collected and stored last week resurfacing under a different subscription's catch-up window); checking only the persisted store on every entry would be correct but this feature does no file I/O itself (spec Out of Scope) — so the "already persisted" check is a narrow read-only hook into 003, not a re-implementation of 003's storage.

**Alternatives considered**: Rely solely on 003 rejecting a duplicate write — rejected because that still means this feature would run enrichment (network calls) and possibly summarization (004) needlessly for a paper it's about to discard, wasting a Semantic Scholar call and an LLM call that FR-009's "processed only once" is meant to avoid, not just "stored once."

## 9. `sourceId` normalization for enrichment-supplied references

**Decision**: When Semantic Scholar enrichment returns a paper's references/citations, each reference is mapped to a `PaperSourceId` (001's `arxiv:<id>` / `semanticScholar:<id>` template-literal type) by checking the reference's `externalIds.ArXiv` field first; if present, the reference's `sourceId` is `arxiv:<that id>`. Only when no arXiv ID is present does the reference keep a `semanticScholar:<paperId>` identifier.

**Rationale**: Directly implements the clarified `sourceId`-normalization answer, and keeps enrichment-sourced references compatible with 001's existing `PaperSourceId` type with zero changes to that type — this feature is purely a consumer/producer of values already shaped by 001.

**Alternatives considered**: Always keep `semanticScholar:` scheme regardless of arXiv-ID availability — rejected per the clarification answer, since it would prevent graph edges (006) from connecting a Semantic-Scholar-supplied reference to the same paper when it was (or later is) independently collected via arXiv under an `arxiv:` id.

## 10. Pipeline hand-off to 003 (persistence) and 004 (summarization)

**Decision**: `pipeline.ts` accepts two injected async callbacks at construction/wiring time — `summarize?: (paper: Paper) => Promise<{ summary: string; futureDirections: string } | undefined>` and `persist: (paper: Paper) => Promise<void>` — rather than importing 003/004 modules directly. `main.ts` (or a small composition point) supplies the real 003/004 implementations once those features exist; until then, tests/quickstart can supply stub callbacks.

**Rationale**: FR-017 requires this feature to *sequence* enrichment → summarization → persistence without *implementing* summarization or file I/O. Dependency injection via callback parameters (rather than direct imports of `src/notes/...` or `src/summarization/...` modules that don't exist yet) lets 002 be implemented, and its pipeline logic unit-verified, independently of 003/004's implementation status — matching this repo's incremental, spec-numbered build order. A summarization failure (callback throws or times out) is caught by `pipeline.ts` and treated as "no summary produced," falling through to persistence with the paper's plain abstract, per FR-017's "summarization failure MUST NOT block persistence."

**Alternatives considered**: Direct static imports of 003/004 modules — rejected for now since those modules don't exist yet in this repository; revisit once 003/004 land (likely a mechanical swap from injected callbacks to direct calls, or keeping the injection seam for testability).

## 11. arXiv query construction, date-range windowing, and pagination

**Decision**: `queryArxiv` builds a `search_query` combining the subscription's own term with a `submittedDate` range clause via `AND`, per arXiv's documented syntax:
- `keyword` → `` all:"<value>" AND submittedDate:[<from> TO <to>] ``
- `author` → `` au:"<value>" AND submittedDate:[<from> TO <to>] ``
- `arxivCategory` → `` cat:<value> AND submittedDate:[<from> TO <to>] ``

where `<from>`/`<to>` are the `CollectionWindow` bounds formatted as arXiv's `YYYYMMDDTTTT` (GMT). Results are paged with `start`/`max_results` (0-based `start`, `max_results = 100` per page — well under arXiv's own 2000-per-call ceiling and its "refine queries returning more than 1,000 results" guidance) until arXiv returns fewer than `max_results` entries for that page (window fully covered) or a safety cap of **10 pages / 1,000 entries** is hit for a single subscription's single check. Hitting the cap sets `truncated: true` (reusing the FR-014 mechanism — no separate signal is introduced) and stops paging rather than continuing indefinitely. A fixed **3-second delay** is inserted between successive page requests for the *same* subscription's query, per arXiv's own rate-limit guidance ("we encourage you to play nice and incorporate a 3 second delay").

**Rationale**: arXiv's API documentation is explicit about all three of these (pagination parameters, a documented per-call/total ceiling, and a requested inter-request delay) — this is not a judgment call but a direct transcription of the provider's stated contract, needed before `arxivClient.ts` can be implemented at all. Capping at 1,000 entries (not arXiv's own 2,000/30,000 ceiling) matches arXiv's *own* recommendation to keep individual queries under 1,000 results, and keeps a single pathological subscription (e.g., a very broad category right after registration, or a long off-period catch-up) from taking many minutes and dozens of sequential requests before this feature's own `batchQueue` (Decision 6) even starts processing candidates.

**Alternatives considered**:
- *A single `max_results` request per check, no pagination loop*: rejected — a catch-up window after a long off-period, or a broad category subscription, can plausibly exceed arXiv's default/requested page size; silently truncating to one page without setting `truncated: true` would violate FR-014 (user must be informed when a window isn't fully covered).
- *No safety cap (page until arXiv returns nothing new)*: rejected — arXiv's own documentation warns a 30,000-result query "will typically take a little over 2 minutes to return," which would stall a single subscription's check well past what FR-013's "no freezing" spirit intends, and needlessly hammers a third-party API section that explicitly asks callers to self-limit.
- *No inter-page delay*: rejected — directly contradicts arXiv's own stated rate-limit ask; a 3-second delay across at most 10 pages adds at most ~30 seconds to the rare worst-case check, not the common case (most subscriptions' windows return far fewer than 100 results and never page at all).

## 12. Semantic Scholar endpoint shape and rate-limit posture

**Decision**: `fetchSemanticScholarPaper` calls exactly one endpoint — `GET /graph/v1/paper/ARXIV:<arxivId>?fields=citationCount,references.paperId,references.externalIds` (research.md Decision 7's arXiv-ID-only match; no title/author search endpoint is called at all), adding an `x-api-key` header carrying `PluginSettings.semanticScholarApiKey` whenever that optional setting is present (Clarification 2026-07-06, FR-020). A **404** response is mapped directly to `EnrichmentOutcome.status === 'terminalAbsence'` (the paper genuinely isn't in Semantic Scholar's index — matches Decision 7's "positive no-such-paper" case exactly). A **429** (rate-limited) or network-level failure is mapped to a transient-retry attempt (bounded to 3, per Decision 7), with the same 3-second inter-attempt spacing used for arXiv's own pagination (Decision 11) as a conservative default when no API key is configured.

**Rationale**: The 404/429 mapping requires no invented behavior — it follows directly from Semantic Scholar's documented status codes and this feature's own already-decided terminal-vs-transient split (Decision 7); the only new information this research contributes is *which* HTTP status maps to *which* of the two existing `EnrichmentOutcome` branches, so `enrichment.ts` has an unambiguous mapping to implement. Calling only the single-paper-lookup endpoint (never `/paper/search`) is a direct consequence of Decision 7's 2026-07-06 revision to drop the title/author fallback — there is simply no second endpoint for this client to call. An optional API key is supported as an **always-available** setting (not gated behind "only if unauthenticated access proves insufficient") because: it costs nothing when absent (the header is simply omitted, behavior is identical to today), it's a one-line addition to the request given the key is already read from `PluginSettings`, and it gives a user who registers many subscriptions a documented, dedicated rate limit instead of sharing an undocumented, worldwide unauthenticated pool — there's no reason to make that user wait for a future feature when the plumbing is this cheap now.

**Alternatives considered**:
- *No API key support at all, unauthenticated-only*: rejected (revised 2026-07-06) — the original reasoning ("unauthenticated access is sufficient for this feature's low call volume") is still true on average, but it doesn't help the user who registers many subscriptions and *does* hit the shared pool's limits; supporting an optional key costs nothing for users who don't set one, so there's no reason to withhold it.
- *Require an API key*: rejected — would break constitution Principle IV's "no required setup before other features can work" posture and 001/002's "concrete, usable default with no setup" precedent; the key is an optional performance/reliability upgrade, never a prerequisite for enrichment to function.
- *Treat 429 as terminal (stop retrying immediately)*: rejected — a rate-limit response is definitionally transient (the same request would very plausibly succeed moments later), and FR-018 explicitly requires bounded retry for transient failures, only treating a positive absence/unresolved-match as terminal.

## 13. Stripping the arXiv version suffix from `sourceId`

**Decision**: `arxivParser.ts` extracts the base arXiv identifier from the Atom `<id>` element (e.g. `http://arxiv.org/abs/2301.12345v2` → `2301.12345`) by stripping a trailing `vN` version suffix before building `sourceId` as `` `arxiv:${baseId}` ``. `sourceId` therefore never carries a version number.

**Rationale (spec Clarification session 2026-07-06)**: arXiv preprints are frequently revised, and each revision is served under the same base ID with an incrementing version suffix. If `sourceId` included the version, revising a paper would make it look like a brand-new paper to this feature's own dedup (FR-009) and to 003's persisted-store lookup, causing the same underlying paper to be collected (and noted) again every time its author posts a revision. Stripping the version keeps `sourceId` stable across revisions, which is what FR-009/SC-004's "processed only once" is meant to guarantee — a revision is not a new paper for this feature's purposes.

**Consequence, explicitly accepted as out of scope**: because a revision reuses the same `sourceId`, `dedupe.ts`'s `alreadyPersisted` check (Decision 8) will treat a paper's later revision as already collected and skip it — this feature does not re-fetch or update an already-persisted paper's title/abstract/authors when arXiv serves a newer version. Refreshing stored content to match a newer revision is a distinct concern from collection and is left to a future feature (analogous to how citation re-enrichment was deferred; see `specs-futureworks/010-automatic-citation-refresh`), not solved here.

**Alternatives considered**:
- *Keep the version in `sourceId`, dedup on the base ID separately*: rejected — this reintroduces exactly the two-different-identifiers-for-one-paper problem `sourceId` (001 FR-015) exists to prevent, and every consumer of `sourceId` (003, 006) would need its own version-stripping logic instead of this feature fixing it once at the source.
- *Track the arXiv version number as a separate field on `Paper` for future refresh use*: deferred — no current feature (002–008) reads such a field; adding it now would be speculative, unused surface area (contradicts the project's "don't design for hypothetical requirements" convention). Revisit only if a future refresh/re-sync feature is actually proposed.

## 14. Preventing a subscription from being checked twice concurrently

**Decision**: `scheduler.ts` keeps an in-memory `Set<string>` of subscriptions whose `runCheck` is currently in flight, keyed by `` `${subscription.type}:${subscription.value}` `` — **not** by object reference. Before invoking `runCheck` for a subscription — whether from the catch-up pass or a recurring tick — the scheduler skips it if its key is already in that set; otherwise it adds the key, invokes `runCheck`, and removes the key once `runCheck` settles (resolves or rejects).

**Rationale (spec Clarification session 2026-07-06)**: The catch-up pass (Decision 5) and the recurring tick (Decision 4) are two distinct call sites that both eventually invoke the same per-subscription `runCheck`. A catch-up pass covering a long off-period window (large batch, Decision 6's sequential processing) can plausibly still be running when the first recurring tick becomes due, especially for a subscription with a short check interval. Without a guard, both call sites could invoke `runCheck` for the same subscription at the same time, double-processing its window and risking two concurrent `recordChecked` calls racing each other. A skipped subscription loses nothing — its `lastCheckedAt` has not advanced, so it remains due and is simply picked up on the very next opportunity (the tick after this one, or the next load).

**Why a string key, not the `Subscription` object itself**: `SchedulerDeps.getSubscriptions()` (contracts) has no guarantee it returns the same object identity on every call — `subscriptionStore.list()` (data-model.md) may reasonably return a fresh array/copy each time it's called, which is exactly what a catch-up pass and a later tick would do (two separate `getSubscriptions()` calls). A `Set<Subscription>` keyed by object reference would then silently fail to recognize "the same subscription" across those two calls, defeating the whole guard. `type`+`value` is a subscription's natural identity for this purpose — 001 does not define a stable id field, but a given type+value pair is what the user actually registered and is stable across `list()` calls even if the wrapping object is not.

**Alternatives considered**:
- *`Set<Subscription>` keyed by object reference (original draft)*: rejected after review — silently broken unless `getSubscriptions()` is guaranteed to return the exact same object instances every call, which is not part of its contract and not a safe assumption to build on.
- *A persisted "check in progress" flag on `Subscription` (001)*: rejected — this is purely an in-process, single-tab concern (Obsidian runs one plugin instance per vault window); persisting it would add a field to 001's shape and a durability concern (a crash mid-check leaving a stale "in progress" flag) for no benefit over a plain in-memory set that is naturally empty again on every fresh load.
- *Debounce the recurring tick so it can never fire while a catch-up pass is running*: rejected — more complex than a per-subscription guard, and unnecessarily blocks *other*, unrelated subscriptions' ticks just because one subscription's catch-up is slow.

## 15. Sharing persisted storage with 001's `PluginSettings`

**Decision**: The plugin's single `loadData()`/`saveData()` blob has the shape `{ settings: PluginSettings; subscriptions: Subscription[] }`. `subscriptionStore.ts`'s injected `load`/`save` dependencies (`data-model.md` § Subscription store) are not raw `loadData()`/`saveData()` calls themselves — they are thin adapters (wired in `src/main.ts`, T019) that perform a **read-modify-write** against the whole object: `load` reads the whole object and returns just `.subscriptions`; `save` reads the current whole object, replaces only its `.subscriptions` key with the new array, and writes the whole object back.

**Rationale**: 001 already defines `PluginSettings` as a top-level concept with its own defaults, and Obsidian's plugin data model is a single JSON blob per plugin (there is exactly one `loadData()`/`saveData()` pair, not one per feature). If `subscriptionStore.ts`'s `save` instead called `saveData()` with only `{ subscriptions }`, it would silently erase whatever `settings` a person had already configured (and vice versa if a future settings-save path did the same with `subscriptions`). A read-modify-write adapter is the standard fix for "multiple independent writers sharing one persisted blob" and keeps `subscriptionStore.ts` itself agnostic of `PluginSettings`'s existence — it only ever sees its own `Subscription[]` slice.

**Alternatives considered**:
- *Two separate `saveData()`-backed files/keys*: not possible — Obsidian's plugin data API is a single `loadData()`/`saveData()` pair per plugin; there is no built-in multi-file persistence primitive to reach for instead.
- *`subscriptionStore.ts` imports and reads/writes `PluginSettings` directly*: rejected — couples a feature that has nothing to do with settings to 001's settings shape, when a narrow read-modify-write adapter (owned by whoever wires `main.ts`) achieves the same safety without that coupling.

## 16. Surfacing user-facing notices with Obsidian's `Notice` API

**Decision**: Every user-facing notice this feature raises (FR-012's provider-failure notice, FR-014's truncated-window notice) is shown via Obsidian's built-in `Notice` class (`new Notice(message)`), the standard transient toast mechanism every Obsidian plugin has available — not a custom modal, a status-bar item, or a `console` log. `onFailure` (contracts/collection-pipeline.md) is called by `scheduler.ts`; the `main.ts` wiring (T019) or `scheduler.ts` itself constructs the actual `Notice` with bilingual-ready copy (constitution Principle V).

**Rationale**: `Notice` requires no new dependency (it's part of the `obsidian` package already used for `requestUrl`/`registerInterval`), works identically on desktop and mobile, and is exactly what Obsidian users expect for "something happened, here's a transient heads-up" — matching FR-012/FR-014's "MUST be able to inform the user" language without inventing a bespoke notification surface. Deciding this now (rather than deferring, as 005 defers its bulk-refresh progress indicator's exact presentation) is low-risk because there is really only one idiomatic choice here, unlike a progress bar's design space.

**Alternatives considered**:
- *A custom modal*: rejected — far heavier than the message warrants ("this subscription's check failed, will retry"), and modals demand dismissal, interrupting the user for a non-blocking background event.
- *Status bar item*: rejected — status bar space is typically reserved for persistent, glanceable state (matches 008's settings-screen ownership more than a one-off transient failure), not one-off notices.
- *Deferring the exact mechanism to implementation, like 005's progress indicator*: rejected for this specific case — `Notice` is Obsidian's own standard idiom for exactly this kind of message, so there is no real design space left to defer; pinning it now costs nothing and removes an unnecessary implementation-time decision.

## 17. Catch-up runs immediately on load, no artificial startup delay

**Decision**: The catch-up pass (Decision 5) runs as soon as `startScheduler` executes during `onload` — there is no artificial delay (no `setTimeout` before the first catch-up pass begins).

**Rationale**: FR-004/SC-002 require catch-up to happen "when the plugin loads," not "shortly after." An artificial delay would only be motivated by concern over many subscriptions all firing network calls at once right as Obsidian starts (competing with other plugins' own `onload` work) — but this feature already paces its own arXiv calls (Decision 11's inter-page delay, and the per-subscription sequential processing of Decision 6), so a burst of *many different subscriptions'* first requests is bounded by how many subscriptions exist, not by this feature choosing to go slower. Introducing a fixed startup grace period would only delay when a user actually sees their off-period papers show up, for a benefit (avoiding a thundering-herd of plugin-load network calls) that this repo's typical vault scale (a handful to a few dozen subscriptions, per 001/002's design assumptions) doesn't actually need protection against.

**Alternatives considered**:
- *A fixed startup delay (e.g. 2-5 seconds) before the first catch-up pass*: rejected — no concrete problem it solves at this feature's expected scale, and it directly delays the exact user-visible outcome (SC-002) this feature exists to deliver promptly.
- *Staggering catch-up passes across subscriptions with small per-subscription delays*: unnecessary — Decision 6's existing sequential processing already prevents concurrent bursts; there is nothing left to stagger.

## 18. Encoding subscription values safely into an arXiv `search_query`

**Decision**: Before building the `all:"<value>"` / `au:"<value>"` / `cat:<value>` clause (Decision 11), a subscription's `value` has any literal `"` characters stripped (arXiv's query syntax uses `"` to delimit a phrase; an unescaped embedded quote would end the phrase early and corrupt the query), and the fully-assembled `search_query` string (including the `submittedDate` clause) is passed through `encodeURIComponent` before being placed in the request URL's query string.

**Rationale**: FR-001/FR-002 let a user type an arbitrary keyword or author value with no format validation described in the spec — that value can contain spaces, punctuation, or (rarely but plausibly) a literal quote character. Stripping embedded `"` before wrapping the value in arXiv's own quote delimiters prevents a malformed query (which could either error or silently search for something other than what the user intended); `encodeURIComponent` on the whole assembled string is the standard, minimal-risk way to make a search string with spaces/special characters safe inside a URL, matching how `requestUrl` expects a fully-formed URL rather than performing its own query-string encoding.

**Alternatives considered**:
- *Reject/validate subscription values containing quotes at registration time (subscriptionStore, FR-001)*: rejected — adds user-facing validation friction for a problem that's fully solved transparently at query-construction time; no reason to make this the user's problem.
- *URL-encode the raw value only, not the whole assembled query*: rejected — arXiv's own `:`/`+`/bracket syntax in `submittedDate:[...]` and the `AND` keyword also need to survive as literal query syntax, not be individually re-encoded piecemeal; encoding the fully-assembled string once is simpler and less error-prone than tracking which substrings need encoding and which don't.

## 19. Formatting `CollectionWindow` bounds as arXiv's GMT date-range syntax

**Decision**: Converting a `CollectionWindow`'s `from`/`to` (epoch ms, per `data-model.md`) into arXiv's `YYYYMMDDTTTT` format MUST use UTC-based `Date` accessors (`getUTCFullYear()`, `getUTCMonth()`, etc., or equivalently `toISOString()`-derived components) — never the local-timezone accessors (`getFullYear()`, `getMonth()`, etc.).

**Rationale**: arXiv's `submittedDate` range is explicitly documented as GMT. `epoch ms` (what `CollectionWindow` already stores, per `data-model.md`) is timezone-agnostic by definition, but formatting it into arXiv's date-string syntax requires picking an explicit timezone for the *rendered* string — using local-timezone `Date` accessors on a machine not set to UTC would silently shift the requested window by the local UTC offset (e.g., a user in UTC+9 would have their catch-up window's boundaries shifted by 9 hours from what `CollectionWindow.from`/`to` actually mean), which would either miss papers right at the window's edge or re-fetch ones just outside it. This is exactly the kind of quiet, hard-to-notice bug that's cheap to prevent by naming the correct accessor family now, before `arxivClient.ts` is written.

**Alternatives considered**:
- *Rely on the implementer to "remember" to use UTC*: rejected — this is precisely the kind of easy-to-get-wrong, hard-to-notice-in-testing (correct in UTC-based CI, subtly wrong for a developer/user in a non-UTC timezone) bug worth pinning down explicitly in research now rather than leaving as an unstated assumption.

## 20. Registration idempotency on `(type, value)`, and label defaulting

**Decision**: `subscriptionStore.register` treats `(type, value)` as a natural, collision-free identity: before creating a new `Subscription`, it checks `list()` for an existing one with the same `type` and `value`; if found, that existing subscription is returned unchanged and the newly-supplied `label`/`checkIntervalHours` are discarded. `label` itself becomes optional in `register`'s input, defaulting to `value` when omitted.

**Rationale (spec Clarification session 2026-07-06)**: Two problems converge here. First, 001 requires every `Subscription` to have a `label`, but nothing in 002 previously said where that value comes from if a caller (a future, simpler settings UI) only collects `value` — defaulting to `value` costs nothing and matches 001's own note that label and value may be identical in content. Second, and more importantly: the scheduler's in-flight guard (Decision 14) keys on `` `${type}:${value}` `` for correctness, not just convenience — if two distinct `Subscription` objects could legitimately share a `(type, value)` pair (e.g. registered twice by mistake, with different labels or intervals), the guard would conflate them, silently skipping one's check whenever the other's happened to be in flight. Making `(type, value)` a true unique key at the point of registration removes this failure mode at its source rather than requiring the scheduler to work around it.

**Alternatives considered**:
- *Allow duplicate `(type, value)` subscriptions, key the in-flight guard some other way (e.g. a generated id)*: rejected — 001 does not define a stable subscription id, so "some other way" would mean adding one just to disambiguate a case (duplicate subscriptions) that has no legitimate use: two subscriptions with the same type and value would search, discover, and process the exact same set of papers, just twice — pure waste, never a feature.
- *Reject registration outright (throw/return an error) when `(type, value)` already exists*: rejected in favor of the friendlier "return the existing one" — a UI (008) that lets a user "add" a subscription that already exists shouldn't need special error-handling for what is, from the user's perspective, a no-op, not a mistake worth surfacing as an error.
- *Merge the newly-supplied label/interval into the existing subscription on a duplicate registration*: rejected — silently changing an existing subscription's label/interval as a side effect of an "add" action would be surprising; a user who wants to change those uses the existing, explicit `setCheckInterval`/relabel path instead (see Decision 21 on why relabeling itself is out of scope for now).

## 21. Editing a subscription's `type`/`value`/`label` after creation is out of scope

**Decision**: Once a subscription is registered, its `type` and `value` can never be changed — only `enabled` and `checkIntervalHours` can (FR-002). To track a different search term, the user deletes the old subscription and registers a new one. `label` similarly has no dedicated "rename" operation in this feature.

**Rationale**: `type`/`value` together define *what* a subscription searches for; changing them mid-life is conceptually closer to replacing the subscription than editing it (the whole collection history, dedup key, and in-flight guard key in Decisions 14/20 are all keyed off `(type, value)`). Scoping this feature to delete-and-recreate for that case avoids a second, parallel "rename" code path whose main job would be re-deriving all of that keyed state anyway. `enabled`/`checkIntervalHours` are safe to support editing in place because nothing else in this feature's design keys off them.

**Alternatives considered**:
- *Support in-place editing of `value`/`label`*: deferred/rejected for v1 — no story in this spec's scope needs it (008's future settings screen can still offer "delete and re-add" as a two-click flow), and supporting it now would mean deciding what happens to the subscription's `lastCheckedAt`/in-flight state mid-edit for a capability nothing currently requires.

## 22. Module layout

**Decision**: New `src/collection/` directory, one file per responsibility (`arxivClient.ts`, `semanticScholarClient.ts`, `arxivParser.ts`, `semanticScholarParser.ts`, `enrichment.ts`, `promotion.ts`, `dedupe.ts`, `batchQueue.ts`, `scheduler.ts`, `pipeline.ts`), each importing only from `src/models/` (001) and, where unavoidable, the `obsidian` package (`requestUrl`, `Plugin` for `registerInterval` typing). `src/main.ts` gains a two-line addition in `onload` to construct and start the scheduler.

**Rationale**: Matches constitution Principle VI and this repo's existing `src/models/` precedent (001) of one focused file per concern; keeps every file comfortably under the ~300-line reconsideration threshold given each file's narrow single responsibility.

**Alternatives considered**: A flatter `src/collection.ts` single file — rejected, would exceed the ~300-line guidance once arXiv/Semantic Scholar parsing, enrichment, scheduling, and batch/dedupe logic are all included, and would tangle unrelated concerns (constitution Principle VI).
