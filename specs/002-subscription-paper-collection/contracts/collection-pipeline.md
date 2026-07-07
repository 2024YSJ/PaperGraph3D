# Contract: `src/collection/` exported API

This is the internal contract 003 (persistence) and 004 (summarization) wiring, and `src/main.ts`, build against. It is a library-style contract — TypeScript types and function signatures exported from `src/collection/*.ts` — not a network/CLI interface exposed to the user directly. This feature is the plugin's *only* module permitted to make external network calls (spec FR-008); nothing here returns a raw provider payload (XML string or provider-shaped JSON object) — every exported function's return type is either a 001 type (`Paper`, `PaperCandidate`) or a plain boolean/void.

## `src/collection/subscriptionStore.ts`

```ts
import type { Subscription, SubscriptionType, CheckIntervalHours } from '../models/subscription';

export interface SubscriptionStoreDeps {
  load: () => Promise<unknown[]>;
  // Returns whatever `loadData()` last read back as JSON — NOT pre-validated as
  // `Subscription[]`. The persisted file is plain JSON a user could hand-edit or that
  // could be partially corrupted; `createSubscriptionStore` is what validates it (see
  // Behavior guarantees below), not the caller. Typing this `unknown[]` rather than
  // `Subscription[]` makes that validation obligation visible at the type level instead
  // of relying on an unchecked cast at the read boundary.
  save: (subscriptions: Subscription[]) => Promise<void>;
  // The caller (src/main.ts, T020) MUST implement `load`/`save` as a read-modify-write
  // against the plugin's single persisted object (`{ settings: PluginSettings; subscriptions: Subscription[] }`,
  // research.md Decision 15) — `save` must read the current whole object, replace only
  // `.subscriptions`, and write the whole object back, never overwrite it wholesale.
  onRegistered?: (subscription: Subscription) => void;
  // Fired by `register` only after a *genuinely new* subscription has been persisted —
  // NOT on an idempotent hit against an existing (type, value). main.ts (T020) wires this
  // to the scheduler's `checkNow` handle so a new subscription is checked immediately
  // rather than up to ~15 min later (FR-028, research.md Decision 34). Keeping it a plain
  // callback keeps subscriptionStore.ts free of any dependency on scheduler.ts.
  onBackfillRequested?: (subscription: Subscription) => void;
  // Fired by `requestBackfill` only after a backfill has actually been started/extended
  // (a validated, non-no-op request that set or lowered backfillState) — NOT on a rejected
  // or no-op request (FR-038). main.ts wires this to the scheduler's `backfillNow` handle so
  // a just-requested backfill begins running immediately, in exact parallel to how
  // onRegistered wires to checkNow. Same callback seam keeps subscriptionStore.ts unaware
  // scheduler.ts / backfill.ts exist (FR-033).
  onInvalidData?: (droppedCount: number) => void;
  // Fired at most once, the first time `load()`'s result is consumed, if any element
  // failed 001's `isValidSubscription` and was dropped (see Behavior guarantees). Optional
  // and purely informational — the store functions correctly with the remaining valid
  // subscriptions regardless of whether a caller supplies this.
}

export function createSubscriptionStore(deps: SubscriptionStoreDeps): {
  list(): Subscription[];
  register(input: { type: SubscriptionType; value: string; label?: string; checkIntervalHours?: CheckIntervalHours }): Promise<Subscription>;
  remove(subscription: Subscription): Promise<void>;
  setEnabled(subscription: Subscription, enabled: boolean): Promise<void>;
  setCheckInterval(subscription: Subscription, requested: number): Promise<CheckIntervalHours>;
  recordChecked(subscription: Subscription, checkedThrough: number, windowFrom: number): Promise<void>;
  requestBackfill(subscription: Subscription, targetFrom: number): Promise<void>;
  recordBackfillProgress(subscription: Subscription, cursor: number): Promise<void>;
  cancelBackfill(subscription: Subscription): Promise<void>;
};
```

**Behavior guarantees**:
- Every element `deps.load()` returns is passed through 001's `isValidSubscription` before entering the store's in-memory list; any element that fails is silently dropped from `list()`'s result (never thrown, never crashes startup) and counted toward a single `deps.onInvalidData?.(droppedCount)` call the first time `load()`'s result is consumed. This guards against a hand-edited or partially corrupted persisted file producing a subscription with, e.g., a non-finite `lastCheckedAt` or a missing `checkIntervalHours` — which would otherwise make the scheduler's due-check arithmetic (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`, contracts § scheduler.ts) evaluate to `NaN`/`true` unpredictably for that one entry, silently freezing or over-firing its checks with no visible cause. Valid subscriptions are otherwise unaffected by a sibling invalid one.
- `register` always produces a `Subscription` that passes 001's `isValidSubscription`; when `checkIntervalHours` is omitted, `DEFAULT_CHECK_INTERVAL_HOURS` (001) is used, and when `label` is omitted it defaults to `input.value` (FR-001).
- `register` rejects (its returned `Promise` throws) when `input.value.trim().length === 0` — before the idempotency check below, before persisting anything (FR-025, SC-011). An empty/whitespace-only value is never stored.
- `register` is idempotent on `(type, value)`: if a subscription with that exact `type` and `value` already exists, it is returned unchanged and `input.label`/`input.checkIntervalHours` are ignored — no duplicate is ever created (FR-001, SC-009). `deps.onRegistered` is invoked **only** on a genuinely-new registration (after `deps.save` resolves), never on this idempotent-hit path, so re-registering an existing subscription triggers no redundant immediate check (FR-028, research.md Decision 34).
- `remove` and `setEnabled` take effect immediately in `list()`'s next result and are persisted via `deps.save` before resolving — a caller awaiting `remove`/`setEnabled` is guaranteed the change is durable, not just in-memory (FR-002/FR-010).
- `setCheckInterval` delegates to 001's `assignCheckInterval`; a disallowed `requested` value leaves the subscription's stored interval unchanged and the returned value reflects what was actually stored (this specific rejection rule is 001's own FR-005, reused here — this feature's own requirement to expose interval-changing at all is FR-002).
- `recordChecked(subscription, checkedThrough, windowFrom)` never moves a subscription's `lastCheckedAt` backward, and is the only way `lastCheckedAt` changes (FR-006) — `scheduler.ts` calls this, nothing else writes to it. This backward-guard is also exactly what implements the clock-backward case (FR-024): when the system clock has moved backward past the stored `lastCheckedAt`, `computeCollectionWindow` collapses to an empty window at the earlier `now` (discovering nothing), and the resulting `recordChecked(subscription, earlierNow, earlierNow)` is a **no-op on `lastCheckedAt`** because `earlierNow < lastCheckedAt` — `lastCheckedAt` is left unchanged rather than moved backward, so no already-covered span is re-opened once the clock returns to normal. (This supersedes an earlier design that advanced `lastCheckedAt` backward to the earlier `now`, which was found to re-search a covered span in violation of FR-006.) **`recordChecked` also atomically initializes `coveredFrom`** (FR-035): in the *same* store write as the `lastCheckedAt` update, if `coveredFrom` is not already set, it is set to `windowFrom` — the check's own `window.from`, i.e. the true start of the span this specific check actually searched. This is a single read-modify-write, not two separate calls (there is no longer a standalone `recordFirstCoverage`), so there is no window in which a crash could leave `lastCheckedAt` set but `coveredFrom` still unset. Because `recordChecked` is only ever invoked after a check *succeeds* (the scheduler never calls it on failure), `coveredFrom`'s first-ever value is always a successful check's own window start, mirroring the same "never record past a window that failed" principle FR-006 already applies to `lastCheckedAt`. On the clock-backward no-op case above, `coveredFrom` is likewise left untouched (there is nothing meaningful to initialize it to from an empty window). Idempotent on the `coveredFrom` half: once set, subsequent calls never raise it back up.
- `recordChecked` is a no-op when its target subscription (matched by `(type, value)` — see below) is no longer present in the store — e.g. it was deleted while its check was in flight. It MUST NOT re-insert the deleted subscription just to hold a `lastCheckedAt` value; any papers that check already discovered were enriched/persisted independently and are unaffected by the subscription's deletion.
- `remove`, `setEnabled`, `setCheckInterval`, and `recordChecked` all identify their target subscription by `(type, value)` — never by object reference/identity — matching the in-flight guard's own keying (scheduler.ts § Behavior guarantees) and reflecting that `list()`/`getSubscriptions()` may return a freshly-constructed `Subscription` object on every call rather than the same object instance a caller originally held.
- `requestBackfill(subscription, targetFrom)` (FR-033/FR-038): rejects (its returned `Promise` throws) when `targetFrom` is empty/`NaN`/non-finite, in the future (`> now`), or otherwise not a valid past instant. It is a **no-op** (resolves without changing anything, and does NOT fire `onBackfillRequested`) when `targetFrom >= coveredFrom` (nothing older to fill) — including when `coveredFrom` is unset, which means no forward coverage exists yet to backfill *below*. On a valid request it sets `backfillState = { targetFrom, cursor: targetFrom }`, persists, and fires `onBackfillRequested?.(subscription)`; when a backfill is already in progress and a *further-past* `targetFrom` arrives, it lowers **both** `backfillState.targetFrom` **and** `backfillState.cursor` to the new value and fires the callback again. Rewinding the cursor is required, not optional: the cursor only ever advances *upward* toward `coveredFrom`, so if it were left in place the newly-added older span `[newTargetFrom, oldCursor)` would never be walked, yet completion would still lower `coveredFrom` to `newTargetFrom` and mark that unvisited span "covered" — silently losing every paper in it (violating FR-036). Re-walking the already-covered `[oldTargetFrom, oldCursor)` prefix costs only some redundant queries; the papers in it are filtered by the existing dedup (FR-009 / `alreadyPersisted`), so no paper is processed twice and none is skipped. This is the sole case in which `backfillState.cursor` moves backward, and it is done by `requestBackfill` writing the field directly — never through `recordBackfillProgress` (whose own guard still forbids a *pass* from moving the cursor backward). Identifies target by `(type, value)`.
- `recordBackfillProgress(subscription, cursor)` (FR-036): advances the persisted `backfillState.cursor` to `cursor` (never backward — like `recordChecked`, a lower value is ignored). On completion — `cursor >= coveredFrom` — it lowers `coveredFrom = backfillState.targetFrom` and clears `backfillState` to `null`, so the backward floor moves down and a later still-earlier `requestBackfill` chains below it without overlap. A no-op when the subscription is no longer present (deleted mid-backfill, FR-037) — it MUST NOT re-insert it. It is likewise a no-op when the subscription **is** present but `backfillState` is already `null` — the race where an in-flight pass's `runCheck` was still resolving when `cancelBackfill` (FR-043) cleared the state out from under it — and MUST NOT re-create `backfillState` in that case; the papers that pass already discovered are enriched/persisted independently of whether its progress gets recorded, exactly as an in-flight forward check's papers are unaffected by a mid-flight disable (Clarification 2026-07-06). This is the only writer of `backfillState`/`coveredFrom` (the latter jointly with `recordChecked`/`requestBackfill`); it never touches `lastCheckedAt` (FR-035).
- `remove` carries a subscription's `backfillState`/`coveredFrom` away with it (they live on the `Subscription` object), so deleting a subscription mid-backfill discards its backfill state (FR-037). `setEnabled(subscription, false)` does not clear `backfillState` — a disabled subscription keeps its persisted cursor so re-enabling resumes from it (FR-037); the *pausing* itself is the scheduler/runner declining to start a new pass for a disabled subscription, not a store mutation.
- `cancelBackfill(subscription)` (FR-043): a no-op if `backfillState` is not set. Otherwise it clears `backfillState` to `null` and **leaves `coveredFrom` untouched** — it MUST NOT set `coveredFrom = backfillState.cursor`. `coveredFrom` means *continuous* coverage from itself up to `now`; a cancelled-mid-run backfill's walked span `[targetFrom, cursor]` is not contiguous with that (it only connects at full completion), so crediting it would mark the unwalked middle span `(cursor, coveredFrom)` as covered despite never having been searched, permanently losing it (a later request over that span is rejected as a no-op by FR-038, since `coveredFrom` would already claim it). Papers the cancelled run already found remain persisted — nothing already collected is lost, only its cursor bookkeeping is discarded. A later `requestBackfill` with the same `targetFrom` therefore restarts the walk from `targetFrom`, re-fetching the already-collected prefix (filtered by dedup, FR-009, at negligible cost) rather than resuming from the old `cursor`. Unlike `setEnabled(false)`, it does not disable the subscription and does not affect `lastCheckedAt` — forward collection is entirely unaffected. Identifies target by `(type, value)`.
- This module builds no UI; the settings-screen UI is 008's responsibility, calling these functions directly.

## `src/collection/scheduler.ts`

```ts
import type { Plugin } from 'obsidian';
import type { Subscription } from '../models/subscription';

const SCHEDULER_TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes (research.md Decision 4)
const ANNOUNCEMENT_LAG_MS = 4 * 24 * 60 * 60 * 1000; // 4 days (research.md Decision 38, FR-041)

export interface SchedulerDeps {
  getSubscriptions: () => Subscription[];
  onSubscriptionChecked: (subscription: Subscription, checkedThrough: number, windowFrom: number) => Promise<void>;
  // windowFrom is the FRONTIER window's own `from` (computeCollectionWindow's result) — passed
  // straight through to subscriptionStore.recordChecked so it can atomically initialize
  // coveredFrom on a subscription's first successful check (FR-035; no separate
  // onFirstCoverage callback — see recordChecked's Behavior guarantees).
  runCheck: (subscription: Subscription, window: { from: number; to: number }) => Promise<{ truncated: boolean; coveredThrough: number }>;
  // `coveredThrough` is the epoch-ms boundary genuinely covered: === window.to when the
  // window was fully covered, or the submission time of the last (newest) paper actually
  // fetched when the window truncated (FR-026, research.md Decision 32). The scheduler
  // records lastCheckedAt from THIS value, never from window.to, so a truncated window
  // advances only over its covered prefix. The SAME runCheck function is also used, with a
  // different (lag re-scan) window, for the FR-041 announcement-lag re-scan — no second
  // dependency is needed for that.
  onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void;
  // User-facing notice hook (FR-012/FR-014). The scheduler calls this only on a STATE
  // TRANSITION into failing for a given subscription+reason (FR-012a) — not on every
  // retry — so a provider down for hours triggers exactly one notice, not one every
  // 15-minute tick. See `ScheduledCheckState.failing` in Behavior guarantees below.
  onBackfillProgress?: (subscription: Subscription, cursor: number) => Promise<void>;
  // Wraps subscriptionStore.recordBackfillProgress; called by the backfill runner after each
  // pass to advance/persist the cursor (and, on completion, lower coveredFrom + clear state).
  // The backfill counterpart to onSubscriptionChecked — NEVER writes lastCheckedAt (FR-035).
  now?: () => number; // defaults to Date.now; injectable for tests
}

// Returns a handle whose `checkNow` runs the same due-check code path a tick uses
// (same computeCollectionWindow, same in-flight guard, same runCheck/onSubscriptionChecked/
// onFailure wiring, same FR-041 lag re-scan) for a single subscription right now. main.ts wires it to
// subscriptionStore's `onRegistered` so a newly-registered subscription is checked
// immediately (FR-028, research.md Decision 34). The SAME checkNow is what a user-triggered
// on-demand check of an EXISTING subscription (FR-032) invokes — FR-032 adds no new check
// implementation, only a user-facing trigger (008's) that calls this handle. `backfillNow`
// is checkNow's backward-collection counterpart (FR-033–040): it runs backfill.ts's runner
// for one subscription, wired by main.ts to subscriptionStore's `onBackfillRequested`.
export function startScheduler(plugin: Plugin, deps: SchedulerDeps): {
  checkNow(subscription: Subscription): Promise<void>;
  backfillNow(subscription: Subscription): Promise<void>;
};

// Deliberately typed on a narrowed Pick, not the full Subscription — this function reads
// only lastCheckedAt, and quickstart.md's scenarios call it with plain { lastCheckedAt }
// literals (never a full Subscription object). Typing the parameter as `Subscription` here
// would make those literals fail tsc --noEmit under strict mode, breaking quickstart.md's
// own "npm run build passes" prerequisite before any scenario could even run.
// This is the FRONTIER window — the one that drives lastCheckedAt — and is NOT the FR-041
// lag re-scan (see computeLagOverlapWindow below, an entirely separate, independent window).
// Two cases (FR-024, FR-030):
//   1. Clock backward (lastCheckedAt !== null && lastCheckedAt > now): { from: now, to: now }.
//      An empty window.
//   2. Otherwise: { from: lastCheckedAt ?? now - 24h, to: now }. FR-030's 24h bound when
//      lastCheckedAt is null (first check); lastCheckedAt itself otherwise.
export function computeCollectionWindow(
  subscription: Pick<Subscription, 'lastCheckedAt'>,
  now: number,
): { from: number; to: number };

// The FR-041 announcement-lag re-scan window — a SECOND, INDEPENDENT window, never fed into
// recordChecked/onSubscriptionChecked and never influencing lastCheckedAt. Undefined when
// there is nothing meaningful to re-scan: a subscription's first check (lastCheckedAt === null
// — no already-checked span exists yet) or a clock-backward reading (lastCheckedAt > now —
// the frontier window is already empty). Otherwise:
//   { from: Math.max(lastCheckedAt - ANNOUNCEMENT_LAG_MS, coveredFrom ?? -Infinity), to: lastCheckedAt }
// The Math.max(..., coveredFrom ?? -Infinity) clamp keeps the re-scan from crossing below the
// subscription's own backward floor into territory only backfill (or nothing yet) has covered.
export function computeLagOverlapWindow(
  subscription: Pick<Subscription, 'lastCheckedAt' | 'coveredFrom'>,
  now: number,
): { from: number; to: number } | undefined;

// Backward-collection counterpart, same narrowed-Pick rationale. Returns the window a
// backfill pass searches — { from: backfillState.cursor, to: coveredFrom } — or undefined
// when there is no active backfillState (nothing to run). Feeds the SAME runSubscriptionCheck
// as forward collection; only the window differs (FR-034).
export function computeBackfillWindow(
  subscription: Pick<Subscription, 'coveredFrom' | 'backfillState'>,
): { from: number; to: number } | undefined;
```

**Behavior guarantees**:
- `startScheduler` registers exactly one recurring interval via `plugin.registerInterval(...)`, firing every `SCHEDULER_TICK_INTERVAL_MS` (15 minutes) (constitution Principle II) — it never calls the global `setInterval` directly, and requires no separate `stop()` call; `onunload` cleanup is automatic. Bounding the tick to 15 minutes bounds how late a due check can fire relative to its exact due time to a small fraction of even the shortest allowed check interval (6 hours).
- On the plugin's first load after `startScheduler` runs, it performs exactly one catch-up pass: for every subscription where `enabled === true`, `runCheck` is invoked once with `window = computeCollectionWindow(subscription, now)` (clock-backward empty window / first-check 24h bound / ordinary `[lastCheckedAt, now]`), `window.to = now` in every case (research.md Decision 29) (FR-004, FR-024, FR-030, Clarification 2026-07-05). See the announcement-lag re-scan bullet below for the separate, additional FR-041 query this same tick-processing logic issues after a successful ordinary check.
- On every subsequent recurring tick, `runCheck` is invoked — with the same `window = computeCollectionWindow(subscription, now)` the catch-up pass uses — for exactly the subscriptions that are both `enabled` and due (`now >= (lastCheckedAt ?? -Infinity) + checkIntervalHours * 3_600_000`) (FR-003). There is exactly one window-computation code path shared by both call sites (research.md Decision 5).
- When more than one subscription is due at once (in either the catch-up pass or a single tick), they are checked **sequentially** — `startScheduler` awaits each `runCheck` to settle before starting the next one's, never `Promise.all`/concurrent invocation (FR-022, research.md Decision 27).
- A subscription whose `` `${type}:${value}` `` key already has a `runCheck` in flight (from either the catch-up pass or a prior tick that hasn't settled yet) is never passed to `runCheck` again until the in-flight call settles (research.md Decision 14) — this applies across both the catch-up pass and every recurring tick, not just within one of them. The guard is keyed by `type`+`value`, never by `Subscription` object identity, since `getSubscriptions()` may return fresh objects on each call; this key is guaranteed collision-free because `subscriptionStore.register` (contracts § subscriptionStore.ts) never allows two subscriptions to share a `(type, value)` pair.
- `onSubscriptionChecked(subscription, coveredThrough, windowFrom)` is called if and only if the *frontier* `runCheck` resolved without throwing, with **its returned `coveredThrough`** (never `window.to` directly, and never a value greater than `window.to`) (FR-006, FR-026) and the frontier `window.from` it was computed with — so a fully-covered window records `checkedThrough === window.to`, while a truncated window records only the newest fetched paper's submission time, leaving the uncovered newer tail to be picked up next check (research.md Decision 32); `windowFrom` lets `recordChecked` atomically initialize `coveredFrom` on a first success (FR-035, contracts § subscriptionStore.ts). A thrown/rejected frontier `runCheck` leaves the subscription's checked-through time (and `coveredFrom`, if still unset) untouched. This applies identically whether the subscription was still `enabled` at the moment `runCheck` settled or was disabled while the check was in flight — an in-flight check is never aborted by a disable, and its `lastCheckedAt` update still applies on success (FR-010, Clarification 2026-07-06); only *starting* a new `runCheck` is what a disable prevents.
- **Announcement-lag re-scan** (FR-041): immediately after a frontier `runCheck` resolves successfully (regardless of whether it was `truncated`) and `onSubscriptionChecked` has been called for it, the scheduler computes `lagWindow = computeLagOverlapWindow(subscription, now)`; if defined, it invokes `runCheck` a **second time** with `lagWindow`, using the exact same `runCheck` dependency (no second function needed — only the window differs, exactly like backfill reusing `runCheck` with its own window). This second call's result — `{truncated, coveredThrough}` — is **entirely discarded**: `onSubscriptionChecked` is not called for it, and neither `lastCheckedAt` nor `coveredFrom` are touched. A rejected or truncated lag re-scan is swallowed without surfacing a notice and without affecting the frontier's already-recorded success — since the lag re-scan carries no persisted cursor, it is simply recomputed and retried, over a window that has itself shifted forward, on the next check; there is no stalled state to escape from and thus no FR-042-style bound needed here. Both calls run under the *same* per-subscription in-flight-guard duration — the guard is not released between the frontier and lag-re-scan calls — so a `checkNow`/scheduled-tick race against this subscription still cannot start until both queries for this check have completed. If the frontier `runCheck` itself rejects or is skipped (in-flight guard, disabled subscription), the lag re-scan is not attempted this cycle either — it is tied to a successful frontier result. The lag re-scan does not apply when `computeLagOverlapWindow` returns `undefined` (first check or clock-backward — see its own doc comment).
- A disabled subscription is never *newly* passed to `runCheck`, on any tick or on the catch-up pass (FR-010) — this only prevents starting new checks, not completing an already-started one (see previous bullet).
- When `runCheck` rejects, `onFailure(subscription, 'unreachable')` is called (when provided) **only if this subscription's `` `${type}:${value}` `` key was not already marked failing for `'unreachable'`** (FR-012a) — the scheduler tracks this in a `ScheduledCheckState.failing: Map<string, 'unreachable' | 'truncated'>` alongside the existing `inFlight` set, setting the entry on this first failure and leaving it in place across every subsequent retry, so a provider down for hours produces exactly one notice, not one per 15-minute tick. The failed subscription is retried on its next due tick or the next load, never advancing past the unsearched window (FR-012). When `runCheck` resolves with `{ truncated: true }` — surfaced this way specifically so the scheduler can react to it without inspecting internal state — `onFailure(subscription, 'truncated')` is likewise gated by the same `failing` map (keyed by reason, so a subscription already marked `'unreachable'` that then starts truncating still gets one fresh `'truncated'` notice, since it's a different reason), but `lastCheckedAt` still advances (via `onSubscriptionChecked(subscription, coveredThrough)`) since a truncated query is not a failed one, just an incompletely-covered one — advancing only to the covered `coveredThrough` boundary, so the uncovered newer remainder is collected next check rather than lost (FR-014, FR-026, research.md Decision 32). On any `runCheck` that succeeds without `truncated: true`, the subscription's `failing` entry (if any) is cleared, so a recovered subscription's next failure notifies again from a clean slate. `scheduler.ts` itself never imports or constructs a `Notice` — it only invokes `deps.onFailure`, a plain callback with no dependency on the `obsidian` package; the actual `new Notice(...)` call (research.md Decision 16) lives in the `onFailure` implementation `main.ts` (T020) supplies, which is what keeps `startScheduler` testable with a stubbed `onFailure` outside a real Obsidian host (exactly what `quickstart.md`'s scenarios do). T017 implements the two `onFailure` call sites (rejection and truncation) plus the `failing`-map gating inside `scheduler.ts`; it does not implement `Notice` display itself. Because the catch-up pass and a regular tick both invoke the same `runCheck`/`onFailure` wiring (no separate implementation per call site — research.md Decision 5), the truncated-window notice fires identically regardless of which one produced it; T019 only verifies this shared behavior surfaces correctly during catch-up, it does not re-implement it.
- **Bounded no-progress escape** (FR-026 escape clause): when a `runCheck` resolves `{ truncated: true }` with a `coveredThrough` that does not advance past `window.from` (i.e. no forward progress, because none of the fetched entries had a readable submission time — see arxivClient.ts `coveredThrough` fallback), the scheduler increments a per-subscription counter in `ScheduledCheckState.noProgress: Map<string, number>` (keyed by `` `${type}:${value}` ``, alongside `inFlight`/`failing`). While progress is being made this counter is reset to 0. Once it reaches `MAX_NOPROGRESS_PASSES` (a module-level constant, `= 3`), the scheduler advances `lastCheckedAt` to `window.to` anyway — abandoning **the entire remainder of that window**, not merely the structurally-unreadable entries within it — and fires `onFailure(subscription, 'truncated')` (subject to the same once-per-reason gating) so the user is told the window could not be fully covered. This is a deliberate, notice-backed exception to the no-loss guarantee: it trades the remainder of a window that has proven structurally unreadable for scheduler liveness, so a subscription can never re-fetch the same unreadable prefix on every tick forever. This is the only case where `recordChecked` advances past a not-fully-covered window's uncovered portion; it is deliberately bounded and notice-backed.
- The catch-up pass (bullet above) runs synchronously as part of `startScheduler`'s own execution during `onload` — no artificial startup delay is introduced before it begins (research.md Decision 17).
- The returned `checkNow(subscription)` runs one subscription through the exact same path a tick uses: it computes `window = computeCollectionWindow(subscription, now)`, respects the same `` `${type}:${value}` `` in-flight guard (so an immediate check and the next scheduled tick can never both process the subscription — whichever starts second is skipped while the first is in flight), invokes `runCheck`, applies the same `onSubscriptionChecked`/`onFailure` handling, and follows it with the same announcement-lag re-scan (FR-041) a tick performs. It is a no-op for a subscription that is not `enabled`. `checkNow` introduces no second, divergent check implementation (FR-028, research.md Decision 34).
- Re-enabling a subscription needs no special handling here: because `lastCheckedAt` did not advance while it was disabled (no checks ran), the ordinary `computeCollectionWindow(subscription, now)` used by the next tick (or by `checkNow`, if a re-enable path chooses to trigger one) naturally spans `[lastCheckedAt, now]` — the whole disabled period — exactly like a plugin-was-off catch-up, and Decision 32's truncation-aware advancement covers an over-large such window across successive checks without loss (FR-029, research.md Decision 35).
- **`checkNow` also serves FR-032** (on-demand check of an existing subscription): the returned `checkNow(subscription)` is invoked both by `onRegistered` (a new subscription, FR-028) and by a user-facing on-demand trigger for an existing subscription (FR-032); it is the same code path either way, and the in-flight guard ensures it never overlaps a scheduled tick for that subscription. The FR-032 trigger itself (command/button) is 008's, per spec Out of Scope — the scheduler only exposes the handle.
- **`backfillNow` and backfill resumption** (FR-033–040, see `backfill.ts` below): `backfillNow(subscription)` drives the backfill **to completion** — it calls `backfill.ts`'s `runBackfillPass` in a loop, `await`ing each pass (which internally yields to the event loop, FR-013) before starting the next, and stops when the `backfillState` is cleared — either a natural completion (cursor reached `coveredFrom`) or a user-initiated `cancelBackfill` (FR-043) mid-run, both of which `computeBackfillWindow` observes identically (returns `undefined` once `backfillState` is gone, so the next loop iteration's `runBackfillPass` call no-ops and the loop exits; no separate scheduler-level cancel call is needed) — the subscription is disabled (paused — FR-037), or a pass fails (retried later — FR-040). Each pass is taken under the same per-subscription `inFlight` guard, so a backfill pass and a forward check for that same subscription never overlap (FR-039); the loop does **not** hold a global lock, so forward ticks for *other* subscriptions continue to run between passes. The recurring tick and the catch-up-on-load pass are a **safety net**: they resume (one pass, then the loop re-arms) any subscription found with an active `backfillState` but no `backfillNow` loop currently running — e.g. after a plugin restart interrupted a backfill mid-history, or after a failed pass. Backfill records progress via `deps.onBackfillProgress`, never `onSubscriptionChecked`, so `lastCheckedAt` is untouched (FR-035).

## `src/collection/pipeline.ts`

```ts
import type { Paper, PaperCandidate, PaperSourceId } from '../models/paper';
import type { EnrichmentOutcome } from './enrichment';

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
  isSummarizationEnabled: () => boolean, // called live, not a captured boolean — see Behavior guarantees (FR-021)
  getSemanticScholarApiKey: () => string | undefined, // called live, threaded through to the enrich call (FR-020)
  enrich?: (candidates: PaperCandidate[], apiKey: string | undefined) => Promise<Map<PaperSourceId, EnrichmentOutcome>>,
  // Defaults to the real `enrichFromSemanticScholar` (contracts § enrichment.ts) when
  // omitted — production callers (runSubscriptionCheck, main.ts) never pass this. It exists
  // purely as a dependency-injection seam (matching Decision 10's rationale for summarize/
  // persist/alreadyPersisted) so quickstart.md/tests can substitute a stub and verify
  // Phase 1/2's apply-then-promote logic (research.md Decision 33/36) with zero live network
  // calls — without this seam, enrichment was the one hard-coded internal call that could
  // never be stubbed, contradicting quickstart.md's own "no requestUrl call ever fires"
  // premise (research.md Decision 36).
): Promise<void>;

// The composition point: turns "a subscription and a window" into candidates (via
// queryArxiv's entries, each mapped through arxivParser.ts's parseArxivEntry — never
// parseArxivAtom, which expects a whole XML document, not an already-parsed entry
// node) and runs them through runCollectionPass. This is the concrete function
// startScheduler's `runCheck` dependency (contracts § scheduler.ts) wraps — no other
// task builds this orchestration.
export function runSubscriptionCheck(
  subscription: { type: 'keyword' | 'author' | 'arxivCategory'; value: string },
  window: { from: number; to: number },
  hooks: PipelineHooks,
  isSummarizationEnabled: () => boolean,
  getSemanticScholarApiKey: () => string | undefined,
  enrich?: (candidates: PaperCandidate[], apiKey: string | undefined) => Promise<Map<PaperSourceId, EnrichmentOutcome>>,
  // Forwarded unmodified to runCollectionPass (same default/DI-seam rationale above).
): Promise<{ truncated: boolean; coveredThrough: number }>;
```

**Behavior guarantees**:
- `runCollectionPass` runs in two phases (research.md Decision 33). **Phase 1 (gather + batch-enrich):** it drains the candidate iterable into an array (bounded ≤ `ARXIV_MAX_PAGES × ARXIV_PAGE_SIZE` = 1,000 by the arXiv cap, Decision 11), drops any candidate already `seen` in this run or for which `hooks.alreadyPersisted` resolves `true` (FR-009), drops any candidate that fails the FR-011 year gate, then calls `enrichFromSemanticScholar(survivors, getSemanticScholarApiKey())` **once** (which itself chunks to ≤500 ids per provider request) to build a `Map<PaperSourceId, EnrichmentOutcome>`. **Phase 2 (sequential per-paper):** it iterates the survivors **one at a time**, never concurrently (FR-013) — looking up each one's pre-fetched `EnrichmentOutcome` from the map (no per-paper network call), **applying it to the candidate before promotion**: when the outcome's `status` is `'enriched'`, the candidate's `citationCount`/`references` are overwritten with `outcome.citationCount`/`outcome.references` (so `promote`'s underlying `toPaper` derives `citationsKnown = true`); when `'terminalAbsence'`/`'transientFailure'`, the candidate is left unchanged (`citationCount`/`references` stay `undefined`, so `toPaper` derives `citationsKnown = false`) — then promoting, optionally summarizing, and persisting — and never calls `hooks.persist` for a second candidate before the previous candidate's summarize → persist has settled.
- A candidate whose `sourceId` is already `seen` in this run, or for which `hooks.alreadyPersisted` resolves `true`, is dropped in Phase 1 before it is ever enriched or summarized (FR-009) — no wasted batch-enrichment slot or LLM call on a known duplicate.
- Enrichment is performed by calling the `enrich` parameter (defaulting to the real `enrichFromSemanticScholar`, contracts § enrichment.ts, when the caller omits it) — it is not a `PipelineHooks` field, since it is not owned by 003/004 the way `persist`/`summarize` are, but it IS a DI seam for the same reason those are (research.md Decision 36) — called **once per pass over the whole surviving candidate set** (batched, research.md Decision 33), not once per candidate. `runCollectionPass` calls `getSemanticScholarApiKey()` fresh for that call and passes the result straight through as `enrich`'s second argument (FR-020); this is the only path an API key reaches enrichment from this function.
- A candidate that fails `promote` (missing/non-finite publication year) is skipped without calling any hook (FR-011) — this is not treated as an error.
- `hooks.summarize` receives only `{ title, abstract, citationCount, citationsKnown }` — never the full `Paper` (never `sourceId`/`references`/`authors`/`publicationYear`) — so an external summarization provider (004) is handed no more data than it needs to decide summary vs. summary+future-directions content (research.md Decision 22).
- `isSummarizationEnabled()` is called **twice** per candidate — once before deciding whether to invoke `hooks.summarize` at all, and once again immediately after `hooks.summarize` resolves (research.md Decision 26, FR-021). If the first call is `false`, absent `hooks.summarize`, a rejection, or a timeout, `hooks.persist` is called with `summary` omitted (`undefined`) — this is what "004's abstract fallback applies and the paper is still saved" (FR-017) means at the call level. If the first call was `true` and `hooks.summarize` *did* return a result, but the **second** call to `isSummarizationEnabled()` (evaluated after the `await`) is now `false`, that result is discarded — `summary` is still passed as `undefined` to `hooks.persist` — satisfying 004's own FR-009 "discard any in-flight generation" requirement, since 004 has no way to do this itself. **`persist`'s `summary` argument is the only path 004's generated text ever reaches 003 through** — there is no other hook or side channel; a `summarize` result that isn't passed to the following `persist` call (whether because it was never generated or because it was discarded per the freshness re-check) is the expected behavior for this exact scenario, not a bug.
- `runCollectionPass` never throws for an individual candidate's enrichment/summarization failure — it logs/surfaces the failure and continues to the next candidate, so one bad entry cannot abort an entire batch (FR-012 applied at the per-paper level).
- `hooks.alreadyPersisted` and `hooks.persist` both assume 003 exposes, respectively, an existence-check-by-`sourceId` capability and an upsert-by-`sourceId` capability — as of this writing, `specs-input/003-paper-note-persistence/spec.md`'s Functional Requirements are write-only (create/update/delete) and define no query/read capability at all (see research.md Decision 23). This feature's contract does not implement or stand in for that capability; it only assumes 003 will provide it once specified. `main.ts` (T020) wires stub implementations of both hooks until 003 exists.
- `runSubscriptionCheck` is the concrete composition this feature ships as `startScheduler`'s (contracts § scheduler.ts) `runCheck` dependency: it calls `queryArxiv(subscription, window)` (contracts § arxivClient.ts), maps each of its `entries` through `parseArxivEntry` (contracts § arxivParser.ts — **not** `parseArxivAtom`, which takes a whole XML document rather than one already-parsed entry) into an `AsyncIterable<PaperCandidate>` — silently skipping any `undefined` result (FR-023) rather than propagating it — and hands that to `runCollectionPass`, forwarding its own `isSummarizationEnabled`/`getSemanticScholarApiKey`/`enrich` parameters straight through unmodified — then returns `{ truncated, coveredThrough }` exactly as `queryArxiv` reported them, so `startScheduler` (research.md Decision 5) can both surface the FR-014 notice and record `lastCheckedAt` at the covered boundary (FR-026, Decision 32) without either function needing to know about the other's internals (research.md Decision 24). `main.ts` (T020) never passes `enrich` — it relies on the default, so production always calls the real `enrichFromSemanticScholar`.

## `src/collection/backfill.ts`

```ts
import type { Subscription } from '../models/subscription';
import type { PipelineHooks, runSubscriptionCheck } from './pipeline';

export interface BackfillRunnerDeps {
  runCheck: (subscription: Subscription, window: { from: number; to: number }) => Promise<{ truncated: boolean; coveredThrough: number }>;
  // The SAME runCheck the scheduler uses (wraps runSubscriptionCheck) — backfill introduces
  // no second collection path; only the window differs (FR-034).
  onBackfillProgress: (subscription: Subscription, cursor: number) => Promise<void>;
  // Wraps subscriptionStore.recordBackfillProgress (advance cursor; on completion lower
  // coveredFrom + clear state). NEVER onSubscriptionChecked — lastCheckedAt is untouched (FR-035).
  onFailure?: (subscription: Subscription, reason: 'unreachable' | 'truncated') => void;
}

// Runs ONE backfill pass for a subscription over computeBackfillWindow(subscription)
// (oldest-first) and returns. `backfillNow` (scheduler) is the primary driver — it loops this
// to completion, one pass at a time (see scheduler.ts § backfillNow); the recurring tick is a
// safety net that re-arms an interrupted backfill. A no-op when the subscription has no active
// backfillState, is not enabled (FR-037), or computeBackfillWindow is empty.
export function runBackfillPass(subscription: Subscription, deps: BackfillRunnerDeps): Promise<void>;
```

**Behavior guarantees**:
- Computes `window = computeBackfillWindow(subscription)` (`{ from: cursor, to: coveredFrom }`); if `undefined` (no active `backfillState`) or `window.from >= window.to` (cursor already reached the floor), it is a no-op. It never reads or writes `lastCheckedAt` and never calls `computeCollectionWindow` (FR-035).
- Invokes the **same** `runCheck`/`runSubscriptionCheck` forward collection uses, with the backfill window — so discovery (arXiv, `submittedDate` ascending), parse, batch-enrich, promote, dedup (FR-009), summarize, and persist are byte-for-byte the forward pipeline, and the produced `Paper`/`citationsKnown` are identical (FR-034). Papers the forward pass already stored are dropped by the same `alreadyPersisted`/`seen` dedup — a backfill overlapping forward-covered papers re-processes none (FR-034/FR-009).
- On a resolved pass it advances the cursor to `runCheck`'s returned `coveredThrough` via `onBackfillProgress` — the covered oldest-first prefix, reusing FR-026's truncation-aware advancement — so a window larger than the paging cap is covered across successive passes and continues after a plugin restart (the cursor is persisted). No historical paper in the window is lost (FR-036). When the cursor reaches `coveredFrom`, `recordBackfillProgress` (inside `onBackfillProgress`) lowers `coveredFrom = targetFrom` and clears `backfillState`, ending the run.
- **Bounded no-progress escape** (FR-042, symmetric to the scheduler's FR-026 escape): the runner tracks its own per-subscription no-progress counter — a separate `backfillNoProgress: Map<string, number>`, keyed the same way (`${type}:${value}`) as the scheduler's forward-only `noProgress` map but not shared with it, since a forward check and a backfill pass truncating for unrelated reasons should not affect each other's escape threshold. When a pass resolves `{truncated: true}` with a `coveredThrough` that does not advance past `window.from` (no forward progress, because none of the fetched entries had a readable submission time), the counter increments; on any pass that does make progress it resets to 0. Once it reaches `MAX_NOPROGRESS_PASSES` (`= 3`, same constant FR-026 uses), the runner forces the cursor forward to `window.to` anyway — abandoning **the entire remainder of that pass's window**, not merely the structurally-unreadable entries within it — via `onBackfillProgress`, fires `onFailure(subscription, 'truncated')`, and the loop continues from the new cursor (or ends, if that reached `coveredFrom`). Without this, `backfillNow`'s completion loop (scheduler.ts § backfillNow) would retry the exact same stalled pass forever, since "no progress" is not one of its three loop-exit conditions (completion, disable, failure).
- A rejected `runCheck` does **not** advance the cursor (`onBackfillProgress` is not called), is surfaced via `onFailure(subscription, 'unreachable')` under the scheduler's same once-per-reason gating, and is retried on a later tick/load — exactly as a forward failure (FR-040). A `{ truncated: true }` resolution still advances the cursor to `coveredThrough` and fires `onFailure(subscription, 'truncated')` (FR-014), signalling "more coming next pass," identical to forward truncation.
- The caller (scheduler) wraps every `runBackfillPass` in the shared `inFlight` guard keyed by `` `${type}:${value}` ``, so a subscription's backfill pass and its forward tick can never run concurrently (FR-039). The runner yields to the event loop within `runCollectionPass` exactly as forward collection does, so a large-history pass never freezes the UI (FR-013).

## `src/collection/arxivParser.ts` / `semanticScholarParser.ts`

```ts
import type { PaperCandidate, PaperSourceId } from '../models/paper';

// types.ts (T003) — shared by both parsers, never re-implemented per-file
export function stripArxivVersion(rawId: string): string;

// Operates on a single already-parsed Atom <entry> node — this is what queryArxiv's
// `entries` (contracts § arxivClient.ts) actually are, and what runSubscriptionCheck
// (contracts § pipeline.ts) maps each of them through. Returns undefined (never
// throws) when the entry is too structurally incomplete to build a PaperCandidate
// at all (e.g. no extractable <id>) — FR-023, research.md Decision 28.
export function parseArxivEntry(entry: Element): PaperCandidate | undefined;

// Convenience wrapper for a whole Atom document (e.g. for quickstart/manual testing):
// DOMParser.parseFromString(xml) -> each <entry> -> parseArxivEntry, filtering out
// any undefined results. Not used by runSubscriptionCheck, which already has
// individual entry nodes from queryArxiv and would gain nothing by re-serializing
// them back into one XML string first.
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
- `parseArxivEntry` builds the candidate's `sourceId` as `` `arxiv:${stripArxivVersion(rawId)}` `` from the entry's `<id>` element (research.md Decision 13); it returns `undefined` — never throws — when the entry has no extractable `<id>` (or is otherwise too incomplete to construct a `PaperCandidate`), which callers (`parseArxivAtom`, `runSubscriptionCheck`) filter out rather than treat as an error (FR-023, research.md Decision 28). `parseArxivAtom(xml)` is exactly `Array.from(new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('entry')).map(parseArxivEntry).filter(candidate => candidate !== undefined)` — it introduces no parsing logic of its own.
- `parseSemanticScholarPaper` maps a raw Semantic Scholar JSON body into `SemanticScholarPaper`; both `SemanticScholarPaper.arxivId` and every `SemanticScholarReference.arxivId` are passed through `stripArxivVersion` before being stored on these intermediate types — **never assumed to already arrive version-free from Semantic Scholar's `externalIds.ArXiv` field** (research.md Decision 9/13).
- `toPaperSourceId(reference)` returns `` `arxiv:${reference.arxivId}` `` (already version-stripped by `parseSemanticScholarPaper`) when `reference.arxivId` is defined, otherwise `` `semanticScholar:${reference.semanticScholarId}` ``. This is the single function both `enrichment.ts` (building `EnrichmentOutcome.references`) and any future caller use — there is exactly one place this mapping happens.
- Because `stripArxivVersion` is called by both parsers on every arXiv ID they handle, a paper's own `sourceId` (from `parseArxivEntry`) and any reference *to that paper* (via `toPaperSourceId`) are guaranteed to produce the identical string, regardless of which parser produced which — this is what graph edge matching (006, exact `sourceId` equality) depends on.

## `src/collection/enrichment.ts`

```ts
import type { PaperCandidate, PaperSourceId } from '../models/paper';

export type EnrichmentOutcome =
  | { status: 'enriched'; citationCount: number; references: PaperSourceId[] }
  | { status: 'terminalAbsence' }
  | { status: 'transientFailure' };

// Batch enrichment (research.md Decision 33): takes the whole surviving candidate set for
// a check and returns one outcome per candidate, keyed by sourceId. Internally chunks to
// the provider's per-request id maximum (≤500) and issues one POST /paper/batch per chunk,
// NOT one request per candidate. A candidate the batch reports no record for maps to
// 'terminalAbsence'; a whole-chunk 429/network failure retries the chunk a bounded 3 times
// before mapping every id in it to 'transientFailure' (FR-027, FR-018).
export function enrichFromSemanticScholar(
  candidates: PaperCandidate[],
  apiKey: string | undefined,
): Promise<Map<PaperSourceId, EnrichmentOutcome>>;
```

**Behavior guarantees**:
- Identity matching is **arXiv-ID only** (Clarification 2026-07-06, superseding the 2026-07-05 answer) — there is no title/author fallback, to eliminate the risk of a false-positive match silently attaching the wrong paper's citation data. A candidate whose `sourceId` provider is not `'arxiv'` is not a supported input for this function (arXiv is this feature's sole discovery provider; Semantic Scholar enrichment always starts from an arXiv-sourced candidate).
- The plain arXiv ID for each candidate is extracted from `candidate.sourceId` by stripping the `` `arxiv:` `` prefix (`candidate.sourceId.slice('arxiv:'.length)`) — already version-stripped (Decision 13) — and sent as `` `ARXIV:${id}` `` in the `POST /paper/batch` request's `ids` array (contracts § semanticScholarClient.ts `fetchSemanticScholarBatch`), chunked to ≤500 ids per request (research.md Decision 33). The returned `Map` is keyed by each candidate's full `sourceId`.
- For each element of the batch response that is a paper object, its body is passed to `parseSemanticScholarPaper` (contracts § arxivParser.ts/semanticScholarParser.ts), and each of its `references` is mapped through `toPaperSourceId` to build that id's `{ status: 'enriched'; citationCount; references: PaperSourceId[] }` — this function never returns a raw `SemanticScholarPaper`/`SemanticScholarReference` to its own caller, only fully-mapped `EnrichmentOutcome`s.
- `'terminalAbsence'` is produced for a candidate the batch positively reports no record for (a `null` element in the response array) — never for a network/timeout/5xx/rate-limit failure of the batch request itself, which instead retries that chunk at most 3 times before mapping every id in the chunk to `'transientFailure'` (FR-018, FR-027).
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
): Promise<{ entries: Element[]; truncated: boolean; coveredThrough: number }>;
// entries are individual Atom <entry> DOM nodes, extracted via queryArxiv's own
// DOMParser call (needed anyway to count entries per page for pagination) — NOT
// via arxivParser.ts, so arxivClient.ts (T006) and arxivParser.ts (T008) stay
// independent of each other. Consumed only by arxivParser.ts's parseArxivEntry.
// internally pages by calling buildArxivSearchUrl once per page.
// coveredThrough (FR-026, research.md Decision 32): === window.to when the window was
// fully covered (truncated === false); when truncated, the epoch-ms <published> time of
// the last (newest, since submittedDate-ascending) <entry> actually fetched, so the caller
// advances lastCheckedAt only over the covered prefix. If that newest entry's <published>
// is missing/unparseable, scan backward (newer-to-older among fetched entries) for the
// first one with a valid <published>; if none of the fetched entries has one, coveredThrough
// falls back to window.from (no progress this pass) — coveredThrough MUST NEVER be NaN,
// undefined, or thrown, since it is written straight into the persisted lastCheckedAt.

export function fetchSemanticScholarBatch(
  arxivIds: string[],                 // plain version-stripped ids; the client prefixes each as `ARXIV:<id>` and chunks to ≤500 per request (research.md Decision 33)
  apiKey: string | undefined,         // PluginSettings.semanticScholarApiKey (001 extension, FR-020); omitted from the request when undefined
): Promise<Array<{ body: unknown } | null | { status: 429 } | { status: 'networkError' }>>;
// Wraps POST /graph/v1/paper/batch. Returns one entry per input id, aligned by index:
// a paper object ({ body }) when found, null when the provider has no record for that id
// (→ terminalAbsence), or a chunk-level { status: 429 }/{ status: 'networkError' } for
// every id in a chunk whose request failed after bounded retry (→ transientFailure).
// This is 002 collection's enrichment path (FR-027).

export function fetchSemanticScholarPaper(
  arxivId: string,
  apiKey: string | undefined, // PluginSettings.semanticScholarApiKey (001 extension, FR-020); omitted from the request when undefined
): Promise<{ status: 200; body: unknown } | { status: 404 } | { status: 429 } | { status: 'networkError' }>;
// Single-paper GET /graph/v1/paper/ARXIV:<id>. Retained for 005's per-paper manual
// refresh (naturally one paper at a time); 002's collection path uses the batch form
// above instead (research.md Decision 33). body (when status 200) is raw JSON, consumed
// only by semanticScholarParser.ts. arXiv-ID-only lookup (Clarification 2026-07-06) —
// no title/author search form.
```

**Behavior guarantees**:
- `queryArxiv` short-circuits an **empty window** (`window.from >= window.to`, e.g. the clock-backward case of FR-024): it returns `{ entries: [], truncated: false, coveredThrough: window.to }` immediately, issuing **no** `requestUrl` call at all — there is nothing to search and an inverted/zero-width `submittedDate` range must never be sent to the provider. This is what keeps a clock-backward subscription (which stays due every 15-minute tick until the clock corrects) from firing a pointless provider request on each tick.
- `queryArxiv` builds a `search_query` combining the subscription's type-specific clause (`all:"<value>"` / `au:"<value>"` / `cat:<value>`) with `` AND submittedDate:[<window.from> TO <window.to>] `` (arXiv's date-range syntax; research.md Decision 11), and pages internally with `start`/`max_results=ARXIV_PAGE_SIZE` until a page returns fewer than `ARXIV_PAGE_SIZE` entries (fully covered) or `ARXIV_MAX_PAGES` is reached, inserting `ARXIV_INTER_PAGE_DELAY_MS` between successive page requests.
- `buildArxivSearchUrl` is the sole place `search_query` is assembled: it strips any literal `"` from `subscription.value` before embedding it (arXiv's phrase-delimiter syntax), formats `window.from`/`window.to` into arXiv's `YYYYMMDDTTTT` syntax using UTC-based `Date` accessors only (`getUTCFullYear()` etc., never `getFullYear()`/local-timezone accessors — research.md Decision 19), passes the fully-assembled query string through `encodeURIComponent`, and appends the fixed ordering parameters `&sortBy=submittedDate&sortOrder=ascending` (FR-026, research.md Decision 32 — never arXiv's default relevance sort) before placing it all in the returned URL (research.md Decision 18). Being a pure function (no `requestUrl` call), it is directly testable without a network stub.
- `queryArxiv` calls `buildArxivSearchUrl` once per page (varying only `page.start`) and is otherwise responsible only for the `requestUrl` call, pagination loop, inter-page delay, and computing `coveredThrough` — `window.to` when the window was fully covered, otherwise the epoch-ms `<published>` time of the last (newest, since ascending) `<entry>` it fetched before hitting the cap (FR-026, research.md Decision 32).
- `truncated: true` is returned exactly when the `ARXIV_MAX_PAGES` cap was hit before the window was fully covered — this is this feature's own self-imposed limit (per arXiv's own guidance against >1,000-result queries), not a limit arXiv itself documents on how far back a query can reach. The caller surfaces `truncated: true` to the user (FR-014) **and** advances `lastCheckedAt` only to `coveredThrough`, so a truncated window is covered across successive checks rather than silently accepted as complete or lost (FR-026, research.md Decision 32).
- `fetchSemanticScholarBatch` issues `POST /graph/v1/paper/batch?fields=citationCount,references.paperId,references.externalIds` with body `{ "ids": ["ARXIV:<id>", ...] }`, splitting `arxivIds` into chunks of ≤500 and making one request per chunk (research.md Decision 33). Its result array is index-aligned to the input ids (a `null` element = provider has no record for that id). A chunk-level `429`/network failure is retried a bounded 3 times (with the same spacing as arXiv paging) before its ids are returned as `{ status: 429 }`/`{ status: 'networkError' }` placeholders. The `x-api-key` header handling matches `fetchSemanticScholarPaper` (sent when `apiKey` is present, omitted otherwise; FR-020).
- `fetchSemanticScholarPaper` calls exactly one endpoint, `GET /graph/v1/paper/ARXIV:<arxivId>?fields=citationCount,references.paperId,references.externalIds` — there is no title/author search form (research.md Decision 12). A `404` response and a `429`/network-error response are returned as distinct, typed outcomes — never thrown — so `enrichment.ts` can map `404` to `EnrichmentOutcome.status: 'terminalAbsence'` and `429`/`'networkError'` to a bounded transient retry, without needing to parse an HTTP status out of a caught exception.
- When `apiKey` is a non-empty string, it is sent as an `x-api-key` request header; when `undefined`, the header is omitted entirely and the call behaves exactly as it did before FR-020 (FR-020, research.md Decision 12). This function never reads settings itself — the caller (`enrichment.ts`, ultimately wired from `PluginSettings.semanticScholarApiKey` in `main.ts`) passes the key through explicitly, keeping `semanticScholarClient.ts` free of any dependency on 001's settings shape.
- The raw `entries`/`body` value returned here MUST NOT cross out of `src/collection/` — only `arxivParser.ts`/`semanticScholarParser.ts` may consume it, and only a mapped `PaperCandidate`/enrichment field may leave this directory (FR-008).
