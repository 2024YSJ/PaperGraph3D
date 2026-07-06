# Contract: `src/collection/` exported API

This is the internal contract 003 (persistence) and 004 (summarization) wiring, and `src/main.ts`, build against. It is a library-style contract — TypeScript types and function signatures exported from `src/collection/*.ts` — not a network/CLI interface exposed to the user directly. This feature is the plugin's *only* module permitted to make external network calls (spec FR-008); nothing here returns a raw provider payload (XML string or provider-shaped JSON object) — every exported function's return type is either a 001 type (`Paper`, `PaperCandidate`) or a plain boolean/void.

## `src/collection/subscriptionStore.ts`

```ts
import type { Subscription, SubscriptionType, CheckIntervalHours } from '../models/subscription';

export interface SubscriptionStoreDeps {
  load: () => Promise<Subscription[]>;
  save: (subscriptions: Subscription[]) => Promise<void>;
  // The caller (src/main.ts, T020) MUST implement `load`/`save` as a read-modify-write
  // against the plugin's single persisted object (`{ settings: PluginSettings; subscriptions: Subscription[] }`,
  // research.md Decision 15) — `save` must read the current whole object, replace only
  // `.subscriptions`, and write the whole object back, never overwrite it wholesale.
}

export function createSubscriptionStore(deps: SubscriptionStoreDeps): {
  list(): Subscription[];
  register(input: { type: SubscriptionType; value: string; label?: string; checkIntervalHours?: CheckIntervalHours }): Promise<Subscription>;
  remove(subscription: Subscription): Promise<void>;
  setEnabled(subscription: Subscription, enabled: boolean): Promise<void>;
  setCheckInterval(subscription: Subscription, requested: number): Promise<CheckIntervalHours>;
  recordChecked(subscription: Subscription, checkedThrough: number): Promise<void>;
};
```

**Behavior guarantees**:
- `register` always produces a `Subscription` that passes 001's `isValidSubscription`; when `checkIntervalHours` is omitted, `DEFAULT_CHECK_INTERVAL_HOURS` (001) is used, and when `label` is omitted it defaults to `input.value` (FR-001).
- `register` is idempotent on `(type, value)`: if a subscription with that exact `type` and `value` already exists, it is returned unchanged and `input.label`/`input.checkIntervalHours` are ignored — no duplicate is ever created (FR-001, SC-009).
- `remove` and `setEnabled` take effect immediately in `list()`'s next result and are persisted via `deps.save` before resolving — a caller awaiting `remove`/`setEnabled` is guaranteed the change is durable, not just in-memory (FR-002/FR-010).
- `setCheckInterval` delegates to 001's `assignCheckInterval`; a disallowed `requested` value leaves the subscription's stored interval unchanged and the returned value reflects what was actually stored (this specific rejection rule is 001's own FR-005, reused here — this feature's own requirement to expose interval-changing at all is FR-002).
- `recordChecked` never moves a subscription's `lastCheckedAt` backward, and is the only way `lastCheckedAt` changes (FR-006) — `scheduler.ts` calls this, nothing else writes to it.
- This module builds no UI; the settings-screen UI is 008's responsibility, calling these functions directly.

## `src/collection/scheduler.ts`

```ts
import type { Plugin } from 'obsidian';
import type { Subscription } from '../models/subscription';

const SCHEDULER_TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (research.md Decision 4)

export interface SchedulerDeps {
  getSubscriptions: () => Subscription[];
  onSubscriptionChecked: (subscription: Subscription, checkedThrough: number) => Promise<void>;
  runCheck: (subscription: Subscription, window: { from: number; to: number }) => Promise<{ truncated: boolean }>;
  onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void; // user-facing notice hook (FR-012/FR-014)
  now?: () => number; // defaults to Date.now; injectable for tests
}

export function startScheduler(plugin: Plugin, deps: SchedulerDeps): void;
```

**Behavior guarantees**:
- `startScheduler` registers exactly one recurring interval via `plugin.registerInterval(...)`, firing every `SCHEDULER_TICK_INTERVAL_MS` (15 minutes) (constitution Principle II) — it never calls the global `setInterval` directly, and requires no separate `stop()` call; `onunload` cleanup is automatic. Bounding the tick to 15 minutes bounds how late a due check can fire relative to its exact due time to a small fraction of even the shortest allowed check interval (6 hours).
- On the plugin's first load after `startScheduler` runs, it performs exactly one catch-up pass: for every subscription where `enabled === true`, `runCheck` is invoked once with `window = computeCollectionWindow(subscription, now)` (i.e. `window.from = subscription.lastCheckedAt ?? (now - 24 * 3_600_000)`, `window.to = now`) (FR-004, Clarification 2026-07-05).
- On every subsequent recurring tick, `runCheck` is invoked — with the same `window = computeCollectionWindow(subscription, now)` the catch-up pass uses — for exactly the subscriptions that are both `enabled` and due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`) (FR-003). There is exactly one window-computation code path shared by both call sites (research.md Decision 5).
- A subscription whose `` `${type}:${value}` `` key already has a `runCheck` in flight (from either the catch-up pass or a prior tick that hasn't settled yet) is never passed to `runCheck` again until the in-flight call settles (research.md Decision 14) — this applies across both the catch-up pass and every recurring tick, not just within one of them. The guard is keyed by `type`+`value`, never by `Subscription` object identity, since `getSubscriptions()` may return fresh objects on each call; this key is guaranteed collision-free because `subscriptionStore.register` (contracts § subscriptionStore.ts) never allows two subscriptions to share a `(type, value)` pair.
- `onSubscriptionChecked` is called if and only if `runCheck` resolved without throwing, and is never called with a `checkedThrough` value greater than the `window.to` actually passed to `runCheck` (FR-006) — a thrown/rejected `runCheck` leaves the subscription's checked-through time untouched. This applies identically whether the subscription was still `enabled` at the moment `runCheck` settled or was disabled while the check was in flight — an in-flight check is never aborted by a disable, and its `lastCheckedAt` update still applies on success (FR-010, Clarification 2026-07-06); only *starting* a new `runCheck` is what a disable prevents.
- A disabled subscription is never *newly* passed to `runCheck`, on any tick or on the catch-up pass (FR-010) — this only prevents starting new checks, not completing an already-started one (see previous bullet).
- When `runCheck` rejects, `onFailure(subscription, 'unreachable')` is called (when provided) before moving on to the next subscription; the failed subscription is retried on its next due tick or the next load, never advancing past the unsearched window (FR-012). When `runCheck` resolves with `{ truncated: true }` — surfaced this way specifically so the scheduler can react to it without inspecting internal state — `onFailure(subscription, 'truncated')` is called instead, but `lastCheckedAt` still advances normally since a truncated query is not a failed one, just an incompletely-covered one (FR-014). These are the two distinct notice reasons T017 implements, each shown via Obsidian's `Notice` API (research.md Decision 16), not a custom modal or status-bar item. Because the catch-up pass and a regular tick both invoke the same `runCheck`/`onFailure` wiring (no separate implementation per call site — research.md Decision 5), the truncated-window notice fires identically regardless of which one produced it; T019 only verifies this shared behavior surfaces correctly during catch-up, it does not re-implement it.
- The catch-up pass (bullet above) runs synchronously as part of `startScheduler`'s own execution during `onload` — no artificial startup delay is introduced before it begins (research.md Decision 17).

## `src/collection/pipeline.ts`

```ts
import type { Paper, PaperCandidate } from '../models/paper';

export interface SummarizationInput {
  title: string;
  abstract: string;
  citationCount: number;
  citationsKnown: boolean;
}

export interface SummaryResult {
  summary: string;
  futureDirections: string;
}

export interface PipelineHooks {
  summarize?: (input: SummarizationInput) => Promise<SummaryResult | undefined>;
  persist: (paper: Paper, summary?: SummaryResult) => Promise<void>;
  alreadyPersisted: (sourceId: Paper['sourceId']) => Promise<boolean>;
}

export function runCollectionPass(
  candidates: AsyncIterable<PaperCandidate>,
  hooks: PipelineHooks,
  summarizationEnabled: boolean,
  semanticScholarApiKey: string | undefined, // threaded straight through to every enrichFromSemanticScholar call (FR-020)
): Promise<void>;

// The composition point: turns "a subscription and a window" into candidates and runs them
// through runCollectionPass. This is the concrete function startScheduler's `runCheck`
// dependency (contracts § scheduler.ts) wraps — no other task builds this orchestration.
export function runSubscriptionCheck(
  subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
  window: { from: number; to: number },
  hooks: PipelineHooks,
  summarizationEnabled: boolean,
  semanticScholarApiKey: string | undefined,
): Promise<{ truncated: boolean }>;
```

**Behavior guarantees**:
- Candidates are consumed and handed to enrichment/promotion/persistence **one at a time**, never concurrently (FR-013) — `runCollectionPass` never calls `hooks.persist` for a second candidate before the previous candidate's full pipeline (enrich → optional summarize → persist) has settled.
- A candidate whose `sourceId` is already `seen` in this run, or for which `hooks.alreadyPersisted` resolves `true`, is skipped before enrichment or summarization runs (FR-009) — no wasted network/LLM calls on a known duplicate.
- Enrichment (`enrichFromSemanticScholar`, contracts § enrichment.ts) is called internally by `runCollectionPass` for each non-duplicate candidate — it is not a `PipelineHooks` field. `runCollectionPass`'s `semanticScholarApiKey` parameter is passed straight through to every such call (FR-020); this is the only path an API key reaches enrichment from this function.
- A candidate that fails `promote` (missing/non-finite publication year) is skipped without calling any hook (FR-011) — this is not treated as an error.
- `hooks.summarize` receives only `{ title, abstract, citationCount, citationsKnown }` — never the full `Paper` (never `sourceId`/`references`/`authors`/`publicationYear`) — so an external summarization provider (004) is handed no more data than it needs to decide summary vs. summary+future-directions content (research.md Decision 22).
- `hooks.summarize` is only invoked when `summarizationEnabled` is `true`; when it is `false`, absent, rejects, or its promise never settles within an internal timeout, `hooks.persist` is still called with `summary` omitted (`undefined`) — this is what "004's abstract fallback applies and the paper is still saved" (FR-017) means at the call level. **`persist`'s `summary` argument is the only path 004's generated text ever reaches 003 through** — there is no other hook or side channel; a `summarize` result that isn't passed to the following `persist` call is a bug, not an accepted "fire and forget."
- `runCollectionPass` never throws for an individual candidate's enrichment/summarization failure — it logs/surfaces the failure and continues to the next candidate, so one bad entry cannot abort an entire batch (FR-012 applied at the per-paper level).
- `hooks.alreadyPersisted` and `hooks.persist` both assume 003 exposes, respectively, an existence-check-by-`sourceId` capability and an upsert-by-`sourceId` capability — as of this writing, `specs-input/003-paper-note-persistence/spec.md`'s Functional Requirements are write-only (create/update/delete) and define no query/read capability at all (see research.md Decision 23). This feature's contract does not implement or stand in for that capability; it only assumes 003 will provide it once specified. `main.ts` (T020) wires stub implementations of both hooks until 003 exists.
- `runSubscriptionCheck` is the concrete composition this feature ships as `startScheduler`'s (contracts § scheduler.ts) `runCheck` dependency: it calls `queryArxiv(subscription, window)` (contracts § arxivClient.ts), maps each raw Atom entry through `parseArxivAtom` (contracts § arxivParser.ts) into an `AsyncIterable<PaperCandidate>`, and hands that to `runCollectionPass` — then returns `{ truncated }` exactly as `queryArxiv` reported it, so `startScheduler` (research.md Decision 5) can surface the FR-014 notice without either function needing to know about the other's internals (research.md Decision 24).

## `src/collection/arxivParser.ts` / `semanticScholarParser.ts`

```ts
import type { PaperCandidate, PaperSourceId } from '../models/paper';

// types.ts (T003) — shared by both parsers, never re-implemented per-file
export function stripArxivVersion(rawId: string): string;

export function parseArxivAtom(xml: string): PaperCandidate[];

export interface SemanticScholarPaper {
  paperId: string;
  arxivId: string | undefined;
  citationCount: number;
  references: SemanticScholarReference[];
}

export interface SemanticScholarReference {
  arxivId: string | undefined;
  semanticScholarId: string;
}

export function parseSemanticScholarPaper(body: unknown): SemanticScholarPaper;

export function toPaperSourceId(reference: SemanticScholarReference): PaperSourceId;
```

**Behavior guarantees**:
- `parseArxivAtom` builds each candidate's `sourceId` as `` `arxiv:${stripArxivVersion(rawId)}` `` from the Atom `<id>` element (research.md Decision 13).
- `parseSemanticScholarPaper` maps a raw Semantic Scholar JSON body into `SemanticScholarPaper`; both `SemanticScholarPaper.arxivId` and every `SemanticScholarReference.arxivId` are passed through `stripArxivVersion` before being stored on these intermediate types — **never assumed to already arrive version-free from Semantic Scholar's `externalIds.ArXiv` field** (research.md Decision 9/13).
- `toPaperSourceId(reference)` returns `` `arxiv:${reference.arxivId}` `` (already version-stripped by `parseSemanticScholarPaper`) when `reference.arxivId` is defined, otherwise `` `semanticScholar:${reference.semanticScholarId}` ``. This is the single function both `enrichment.ts` (building `EnrichmentOutcome.references`) and any future caller use — there is exactly one place this mapping happens.
- Because `stripArxivVersion` is called by both parsers on every arXiv ID they handle, a paper's own `sourceId` (from `parseArxivAtom`) and any reference *to that paper* (via `toPaperSourceId`) are guaranteed to produce the identical string, regardless of which parser produced which — this is what graph edge matching (006, exact `sourceId` equality) depends on.

## `src/collection/enrichment.ts`

```ts
import type { PaperCandidate, PaperSourceId } from '../models/paper';

export type EnrichmentOutcome =
  | { status: 'enriched'; citationCount: number; references: PaperSourceId[] }
  | { status: 'terminalAbsence' }
  | { status: 'transientFailure' };

export function enrichFromSemanticScholar(candidate: PaperCandidate, apiKey: string | undefined): Promise<EnrichmentOutcome>;
```

**Behavior guarantees**:
- Identity matching is **arXiv-ID only** (Clarification 2026-07-06, superseding the 2026-07-05 answer) — there is no title/author fallback, to eliminate the risk of a false-positive match silently attaching the wrong paper's citation data. A candidate whose `sourceId` provider is not `'arxiv'` is not a supported input for this function (arXiv is this feature's sole discovery provider; Semantic Scholar enrichment always starts from an arXiv-sourced candidate).
- `'terminalAbsence'` is returned only for a positive "no such paper" (`404`) response — never for a network/timeout/5xx/rate-limit error, which instead yields at most 3 attempts before returning `'transientFailure'` (FR-018).
- Neither `'terminalAbsence'` nor `'transientFailure'` throws — both are normal return values the caller (`pipeline.ts`, via `promotion.ts`) treats identically for promotion purposes (`citationsKnown = false`).

## `src/collection/promotion.ts`

```ts
import type { Paper, PaperCandidate } from '../models/paper';

export function promote(candidate: PaperCandidate): Paper | undefined;
```

**Behavior guarantees**: Identical to 001's `toPaper` contract (this function delegates to it directly; see `specs/001-core-data-models/contracts/data-model-api.md`) — publication year is the only hold-back trigger, and an unenriched candidate is promoted with `citationsKnown = false`, never withheld for missing citation data (FR-016/FR-018).

## `src/collection/arxivClient.ts` / `semanticScholarClient.ts`

```ts
const ARXIV_PAGE_SIZE = 100;        // max_results per request (research.md Decision 11)
const ARXIV_MAX_PAGES = 10;         // safety cap: 1,000 entries per subscription per check
const ARXIV_INTER_PAGE_DELAY_MS = 3_000; // arXiv's own requested rate-limit spacing

// Pure, network-free helper — exported specifically so query construction (quote-stripping,
// UTC date formatting, URL encoding) can be verified without a live network call.
export function buildArxivSearchUrl(
  subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
  window: { from: number; to: number },
  page: { start: number; maxResults: number },
): string; // fully-formed, already-encoded arXiv API URL

export function queryArxiv(
  subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
  window: { from: number; to: number },
): Promise<{ entries: unknown[]; truncated: boolean }>; // entries are raw Atom <entry> DOM nodes, consumed only by arxivParser.ts; internally pages by calling buildArxivSearchUrl once per page

export function fetchSemanticScholarPaper(
  arxivId: string,
  apiKey: string | undefined, // PluginSettings.semanticScholarApiKey (001 extension, FR-020); omitted from the request when undefined
): Promise<{ status: 200; body: unknown } | { status: 404 } | { status: 429 } | { status: 'networkError' }>;
// body (when status 200) is raw JSON, consumed only by semanticScholarParser.ts. arXiv-ID-only lookup (Clarification 2026-07-06) — no title/author search form.
```

**Behavior guarantees**:
- `queryArxiv` builds a `search_query` combining the subscription's type-specific clause (`all:"<value>"` / `au:"<value>"` / `cat:<value>`) with `` AND submittedDate:[<window.from> TO <window.to>] `` (arXiv's date-range syntax; research.md Decision 11), and pages internally with `start`/`max_results=ARXIV_PAGE_SIZE` until a page returns fewer than `ARXIV_PAGE_SIZE` entries (fully covered) or `ARXIV_MAX_PAGES` is reached, inserting `ARXIV_INTER_PAGE_DELAY_MS` between successive page requests.
- `buildArxivSearchUrl` is the sole place `search_query` is assembled: it strips any literal `"` from `subscription.value` before embedding it (arXiv's phrase-delimiter syntax), formats `window.from`/`window.to` into arXiv's `YYYYMMDDTTTT` syntax using UTC-based `Date` accessors only (`getUTCFullYear()` etc., never `getFullYear()`/local-timezone accessors — research.md Decision 19), and passes the fully-assembled query string through `encodeURIComponent` before placing it in the returned URL (research.md Decision 18). Being a pure function (no `requestUrl` call), it is directly testable without a network stub.
- `queryArxiv` calls `buildArxivSearchUrl` once per page (varying only `page.start`) and is otherwise responsible only for the `requestUrl` call, pagination loop, and inter-page delay.
- `truncated: true` is returned exactly when the `ARXIV_MAX_PAGES` cap was hit before the window was fully covered — this is this feature's own self-imposed limit (per arXiv's own guidance against >1,000-result queries), not a limit arXiv itself documents on how far back a query can reach. The caller surfaces `truncated: true` to the user (FR-014) rather than silently accepting a partially-covered window as complete.
- `fetchSemanticScholarPaper` calls exactly one endpoint, `GET /graph/v1/paper/ARXIV:<arxivId>?fields=citationCount,references.paperId,references.externalIds` — there is no title/author search form (research.md Decision 12). A `404` response and a `429`/network-error response are returned as distinct, typed outcomes — never thrown — so `enrichment.ts` can map `404` to `EnrichmentOutcome.status: 'terminalAbsence'` and `429`/`'networkError'` to a bounded transient retry, without needing to parse an HTTP status out of a caught exception.
- When `apiKey` is a non-empty string, it is sent as an `x-api-key` request header; when `undefined`, the header is omitted entirely and the call behaves exactly as it did before FR-020 (FR-020, research.md Decision 12). This function never reads settings itself — the caller (`enrichment.ts`, ultimately wired from `PluginSettings.semanticScholarApiKey` in `main.ts`) passes the key through explicitly, keeping `semanticScholarClient.ts` free of any dependency on 001's settings shape.
- The raw `entries`/`body` value returned here MUST NOT cross out of `src/collection/` — only `arxivParser.ts`/`semanticScholarParser.ts` may consume it, and only a mapped `PaperCandidate`/enrichment field may leave this directory (FR-008).
