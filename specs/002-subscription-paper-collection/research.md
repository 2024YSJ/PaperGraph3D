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

**Decision**: A `scheduler.ts` module exposes `start(plugin: Plugin, subscriptions: () => Subscription[], onDue: (sub) => Promise<void>)` and relies entirely on `plugin.registerInterval(window.setInterval(...))` for the recurring tick (a single coarse interval — e.g. every few minutes — that on each tick checks which enabled subscriptions are now due, rather than one JS timer per subscription). `onload` calls `start(...)` once; because it is registered via `registerInterval`, `onunload` cleanup is automatic and requires no explicit `stop()` bookkeeping.

**Rationale**: Constitution Principle II (NON-NEGOTIABLE) prohibits raw `setInterval` outside `this.registerInterval(...)`. A single coarse recurring tick that re-evaluates all subscriptions' due-times is simpler and leak-proof compared to creating/destroying one OS/JS timer per subscription as subscriptions are added, deleted, or have their interval changed — that approach would require careful teardown bookkeeping (a map of subscription id → timer handle, cleared on delete/interval-change) that is easy to get subtly wrong. The "per-subscription timer" language in the spec's clarification refers to each subscription tracking its *own next-check time* (derived from its own `checkIntervalHours` and `lastCheckedAt`), not to one OS timer object per subscription — a single tick loop that compares "is `now >= lastCheckedAt + checkIntervalHours` for this subscription" achieves exactly that independence of cadence with one registered interval to clean up.

**Alternatives considered**:
- *One `registerInterval` per subscription*: rejected — every subscription add/delete/interval-change would need to create/clear its own timer handle, multiplying the surface for a lifecycle leak that Principle II explicitly calls out as NON-NEGOTIABLE; a single recurring tick sidesteps this entirely.
- *`setTimeout` chains re-armed after each check*: rejected — same per-subscription teardown bookkeeping problem, plus `setTimeout` still needs the same `register*` wrapper treatment and gains nothing over one shared interval.

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

**Decision**: `enrichment.ts` first attempts a Semantic Scholar lookup by arXiv ID (`GET /graph/v1/paper/arXiv:<id>`), which Semantic Scholar's API supports directly. If that returns no match, it falls back to a search-by-title query and accepts the top result only if its first author's surname matches (case-insensitive) the candidate's first author; otherwise the match is unresolved. A provider response that positively indicates "no such paper" (a real 404/empty-result body, not a network error) or an unresolved title+author match is classified as a **terminal absence** — enrichment stops for that paper on this pass, `citationsKnown` stays `false`, and it is not retried by this feature again (only 005's manual refresh or a future auto-heal may retry it later, per FR-018). A genuine transient failure (network error, 5xx, rate-limit response) is retried up to a small bounded count (3 attempts, short backoff) within the same pass before falling through to the same `citationsKnown = false` outcome.

**Rationale**: Directly implements the clarified identity-matching answer and FR-018's "terminal absence vs. bounded transient retry" requirement. Bounding transient retries (rather than retrying indefinitely) keeps a single flaky call from stalling the whole batch-processing loop (Decision 6) or blocking the subscription's `lastCheckedAt` advancement.

**Alternatives considered**:
- *DOI-based matching*: rejected as primary — arXiv preprints frequently lack a registered DOI at collection time; arXiv-ID matching is more universally available for this feature's actual inputs (arXiv-discovered candidates).
- *Unbounded retry until success*: rejected — directly contradicts FR-018's explicit bounded-retry requirement and would risk an unresponsive provider stalling collection indefinitely.

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

## 12. arXiv query construction, date-range windowing, and pagination

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

## 13. Semantic Scholar endpoint shape and rate-limit posture

**Decision**: `fetchSemanticScholarPaper` calls `GET /graph/v1/paper/ARXIV:<arxivId>?fields=citationCount,references.paperId,references.externalIds` for the arXiv-ID-first lookup (research.md Decision 7), and falls back to `GET /graph/v1/paper/search?query=<title>&fields=title,authors,externalIds` (the relevance-search endpoint, not the bulk-search endpoint, since a single best-match lookup — not a large result set — is needed) for the title+first-author fallback. A **404** response is mapped directly to `EnrichmentOutcome.status === 'terminalAbsence'` (the paper genuinely isn't in Semantic Scholar's index — matches Decision 7's "positive no-such-paper" case exactly). A **429** (rate-limited) or network-level failure is mapped to a transient-retry attempt (bounded to 3, per Decision 7), with the same 3-second inter-attempt spacing used for arXiv (Decision 12) as a conservative default, since Semantic Scholar's own unauthenticated-tier rate limit is shared across all callers and not documented with a stable, citable number as of this research.

**Rationale**: The 404/429 mapping requires no invented behavior — it follows directly from Semantic Scholar's documented status codes and this feature's own already-decided terminal-vs-transient split (Decision 7); the only new information this research contributes is *which* HTTP status maps to *which* of the two existing `EnrichmentOutcome` branches, so `enrichment.ts` has an unambiguous mapping to implement. Reusing the same 3-second spacing as arXiv (rather than inventing a separate, unverified number for Semantic Scholar) is a deliberately conservative choice given the shared, undocumented-strength unauthenticated rate limit.

**Alternatives considered**:
- *Register for a Semantic Scholar API key to get a stable, documented rate limit*: deferred, not rejected outright — an API key changes this feature's "no setup required" posture (constitution Principle IV disclosure would need to mention a credential), and unauthenticated access is sufficient for enrichment's bounded, non-bulk call pattern (one lookup per otherwise-complete candidate, not a bulk export). Revisit if unauthenticated throttling proves too aggressive in practice.
- *Treat 429 as terminal (stop retrying immediately)*: rejected — a rate-limit response is definitionally transient (the same request would very plausibly succeed moments later), and FR-018 explicitly requires bounded retry for transient failures, only treating a positive absence/unresolved-match as terminal.

## 14. Module layout

**Decision**: New `src/collection/` directory, one file per responsibility (`arxivClient.ts`, `semanticScholarClient.ts`, `arxivParser.ts`, `semanticScholarParser.ts`, `enrichment.ts`, `promotion.ts`, `dedupe.ts`, `batchQueue.ts`, `scheduler.ts`, `pipeline.ts`), each importing only from `src/models/` (001) and, where unavoidable, the `obsidian` package (`requestUrl`, `Plugin` for `registerInterval` typing). `src/main.ts` gains a two-line addition in `onload` to construct and start the scheduler.

**Rationale**: Matches constitution Principle VI and this repo's existing `src/models/` precedent (001) of one focused file per concern; keeps every file comfortably under the ~300-line reconsideration threshold given each file's narrow single responsibility.

**Alternatives considered**: A flatter `src/collection.ts` single file — rejected, would exceed the ~300-line guidance once arXiv/Semantic Scholar parsing, enrichment, scheduling, and batch/dedupe logic are all included, and would tangle unrelated concerns (constitution Principle VI).
