# Contract: `src/collection/` exported API

This is the internal contract 003 (persistence) and 004 (summarization) wiring, and `src/main.ts`, build against. It is a library-style contract — TypeScript types and function signatures exported from `src/collection/*.ts` — not a network/CLI interface exposed to the user directly. This feature is the plugin's *only* module permitted to make external network calls (spec FR-008); nothing here returns a raw provider payload (XML string or provider-shaped JSON object) — every exported function's return type is either a 001 type (`Paper`, `PaperCandidate`) or a plain boolean/void.

## `src/collection/subscriptionStore.ts`

```ts
import type { Subscription, SubscriptionType, CheckIntervalHours } from '../models/subscription';

export interface SubscriptionStoreDeps {
  load: () => Promise<Subscription[]>;
  save: (subscriptions: Subscription[]) => Promise<void>;
}

export function createSubscriptionStore(deps: SubscriptionStoreDeps): {
  list(): Subscription[];
  register(input: { type: SubscriptionType; value: string; label: string; checkIntervalHours?: CheckIntervalHours }): Promise<Subscription>;
  remove(subscription: Subscription): Promise<void>;
  setEnabled(subscription: Subscription, enabled: boolean): Promise<void>;
  setCheckInterval(subscription: Subscription, requested: number): Promise<CheckIntervalHours>;
  recordChecked(subscription: Subscription, checkedThrough: number): Promise<void>;
};
```

**Behavior guarantees**:
- `register` always produces a `Subscription` that passes 001's `isValidSubscription`; when `checkIntervalHours` is omitted, `DEFAULT_CHECK_INTERVAL_HOURS` (001) is used (FR-001).
- `remove` and `setEnabled` take effect immediately in `list()`'s next result and are persisted via `deps.save` before resolving — a caller awaiting `remove`/`setEnabled` is guaranteed the change is durable, not just in-memory (FR-002/FR-010).
- `setCheckInterval` delegates to 001's `assignCheckInterval`; a disallowed `requested` value leaves the subscription's stored interval unchanged and the returned value reflects what was actually stored (this specific rejection rule is 001's own FR-005, reused here — this feature's own requirement to expose interval-changing at all is FR-002).
- `recordChecked` never moves a subscription's `lastCheckedAt` backward, and is the only way `lastCheckedAt` changes (FR-006) — `scheduler.ts` calls this, nothing else writes to it.
- This module builds no UI; the settings-screen UI is 008's responsibility, calling these functions directly.

## `src/collection/scheduler.ts`

```ts
import type { Plugin } from 'obsidian';
import type { Subscription } from '../models/subscription';

export interface SchedulerDeps {
  getSubscriptions: () => Subscription[];
  onSubscriptionChecked: (subscriptionId: Subscription, checkedThrough: number) => Promise<void>;
  runCheck: (subscription: Subscription, window: { from: number; to: number }) => Promise<void>;
  onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void; // user-facing notice hook (FR-012/FR-014)
  now?: () => number; // defaults to Date.now; injectable for tests
}

export function startScheduler(plugin: Plugin, deps: SchedulerDeps): void;
```

**Behavior guarantees**:
- `startScheduler` registers exactly one recurring interval via `plugin.registerInterval(...)` (constitution Principle II) — it never calls the global `setInterval` directly, and requires no separate `stop()` call; `onunload` cleanup is automatic.
- On the plugin's first load after `startScheduler` runs, it performs exactly one catch-up pass: for every subscription where `enabled === true`, `runCheck` is invoked once with `window.from = subscription.lastCheckedAt ?? (now - 24 * 3_600_000)` and `window.to = now` (FR-004, Clarification 2026-07-05).
- On every subsequent recurring tick, `runCheck` is invoked for exactly the subscriptions that are both `enabled` and due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`) (FR-003).
- `onSubscriptionChecked` is called if and only if `runCheck` resolved without throwing, and is never called with a `checkedThrough` value greater than the `window.to` actually passed to `runCheck` (FR-006) — a thrown/rejected `runCheck` leaves the subscription's checked-through time untouched.
- A disabled subscription is never passed to `runCheck`, on any tick or on the catch-up pass (FR-010).
- When `runCheck` rejects, `onFailure(subscription, 'unreachable')` is called (when provided) before moving on to the next subscription; the failed subscription is retried on its next due tick or the next load, never advancing past the unsearched window (FR-012). When a catch-up/tick's provider response reports `truncated: true`, `onFailure(subscription, 'truncated')` is called instead (FR-014) — these are the two distinct notice reasons T016/T018 implement.

## `src/collection/pipeline.ts`

```ts
import type { Paper, PaperCandidate } from '../models/paper';

export interface PipelineHooks {
  summarize?: (paper: Paper) => Promise<{ summary: string; futureDirections: string } | undefined>;
  persist: (paper: Paper) => Promise<void>;
  alreadyPersisted: (sourceId: Paper['sourceId']) => Promise<boolean>;
}

export function runCollectionPass(
  candidates: AsyncIterable<PaperCandidate>,
  hooks: PipelineHooks,
  summarizationEnabled: boolean,
): Promise<void>;
```

**Behavior guarantees**:
- Candidates are consumed and handed to enrichment/promotion/persistence **one at a time**, never concurrently (FR-013) — `runCollectionPass` never calls `hooks.persist` for a second candidate before the previous candidate's full pipeline (enrich → optional summarize → persist) has settled.
- A candidate whose `sourceId` is already `seen` in this run, or for which `hooks.alreadyPersisted` resolves `true`, is skipped before enrichment or summarization runs (FR-009) — no wasted network/LLM calls on a known duplicate.
- A candidate that fails `promote` (missing/non-finite publication year) is skipped without calling any hook (FR-011) — this is not treated as an error.
- `hooks.summarize` is only invoked when `summarizationEnabled` is `true`; when it is `false`, absent, rejects, or its promise never settles within an internal timeout, the paper still reaches `hooks.persist` (FR-017) with no summary attached.
- `runCollectionPass` never throws for an individual candidate's enrichment/summarization failure — it logs/surfaces the failure and continues to the next candidate, so one bad entry cannot abort an entire batch (FR-012 applied at the per-paper level).

## `src/collection/enrichment.ts`

```ts
import type { PaperCandidate } from '../models/paper';

export type EnrichmentOutcome =
  | { status: 'enriched'; citationCount: number; references: PaperCandidate['references'] & {} }
  | { status: 'terminalAbsence' }
  | { status: 'transientFailure' };

export function enrichFromSemanticScholar(candidate: PaperCandidate): Promise<EnrichmentOutcome>;
```

**Behavior guarantees**:
- Identity matching tries an arXiv-ID lookup first; only on no match does it fall back to a title + first-author match (Clarification 2026-07-05). A candidate whose `sourceId` provider is not `'arxiv'` is not a supported input for this function (arXiv is this feature's sole discovery provider; Semantic Scholar enrichment always starts from an arXiv-sourced candidate).
- `'terminalAbsence'` is returned only for a positive "no such paper" response or an unresolved identity match — never for a network/timeout/5xx/rate-limit error, which instead yields at most 3 attempts before returning `'transientFailure'` (FR-018).
- Neither `'terminalAbsence'` nor `'transientFailure'` throws — both are normal return values the caller (`pipeline.ts`, via `promotion.ts`) treats identically for promotion purposes (`citationsKnown = false`).

## `src/collection/promotion.ts`

```ts
import type { Paper, PaperCandidate } from '../models/paper';

export function promote(candidate: PaperCandidate): Paper | undefined;
```

**Behavior guarantees**: Identical to 001's `toPaper` contract (this function delegates to it directly; see `specs/001-core-data-models/contracts/data-model-api.md`) — publication year is the only hold-back trigger, and an unenriched candidate is promoted with `citationsKnown = false`, never withheld for missing citation data (FR-016/FR-018).

## `src/collection/arxivClient.ts` / `semanticScholarClient.ts`

```ts
export function queryArxiv(
  subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
  window: { from: number; to: number },
): Promise<{ entries: unknown[]; truncated: boolean }>; // entries are raw Atom <entry> DOM nodes, consumed only by arxivParser.ts

export function fetchSemanticScholarPaper(
  identity: { arxivId: string } | { title: string; firstAuthor: string },
): Promise<unknown | undefined>; // raw JSON, consumed only by semanticScholarParser.ts
```

**Behavior guarantees**:
- `truncated: true` signals the provider capped how far back `window.from` could reach; the caller surfaces this to the user (FR-014) rather than silently accepting a partially-covered window as complete.
- The raw `entries`/JSON value returned here MUST NOT cross out of `src/collection/` — only `arxivParser.ts`/`semanticScholarParser.ts` may consume it, and only a mapped `PaperCandidate`/enrichment field may leave this directory (FR-008).
