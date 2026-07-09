# Quickstart: Validating Subscription-Based Paper Collection

Purpose: prove the `src/collection/` modules behave as `spec.md`'s acceptance scenarios and success criteria require, using stubbed provider responses so no live network call is made (per spec's own "Independent Test" wording for every user story). This is a manual, repeatable validation script — not part of the plugin bundle, matching 001's precedent (`research.md` § 1; no test runner is configured in this repo).

## Prerequisites

- `npm install` has been run.
- `src/models/{subscription,paper,settings}.ts` (001) and `src/collection/*.ts` (this feature) exist, and `npm run build` passes (`tsc --noEmit` clean).

## Setup

Create a scratch file (not committed), e.g. `scratch/verify-collection.ts`, that imports the parser/enrichment/promotion/dedupe/pipeline modules and stubs both provider clients so no `requestUrl` call ever fires:

```ts
import { parseArxivAtom } from '../src/collection/arxivParser';
import { promote } from '../src/collection/promotion';
import { runCollectionPass } from '../src/collection/pipeline';
import type { PaperCandidate, Paper } from '../src/models/paper';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
}

const SAMPLE_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.12345v1</id>
    <title>A Sample Paper</title>
    <author><name>Ada Lovelace</name></author>
    <published>2023-01-15T00:00:00Z</published>
    <summary>An abstract.</summary>
  </entry>
</feed>`;
```

## Run

```bash
npx esbuild scratch/verify-collection.ts --bundle --platform=node --outfile=scratch/verify-collection.js
node scratch/verify-collection.js
```

## Scenarios to assert (maps to `spec.md` Acceptance Scenarios)

### Subscription management (User Story 1)

```ts
import { createSubscriptionStore } from '../src/collection/subscriptionStore';

let saved: unknown[] = [];
const store = createSubscriptionStore({
  load: async () => [],
  save: async (subs) => { saved = subs; },
});

const sub = await store.register({ type: 'keyword', value: 'graph neural network', label: 'GNN' });
check('registering a subscription persists it', saved.length === 1);
check('default check interval applied', sub.checkIntervalHours === 24);

const noLabelSub = await store.register({ type: 'keyword', value: 'transformer architecture' });
check('label defaults to value when omitted', noLabelSub.label === 'transformer architecture');

const duplicate = await store.register({ type: 'keyword', value: 'graph neural network', label: 'Something Else', checkIntervalHours: 72 });
check('registering an existing (type, value) returns the existing subscription, not a new one', saved.length === 2 && duplicate.label === 'GNN' && duplicate.checkIntervalHours === 24);

await store.setEnabled(sub, false);
check('disabling a subscription persists immediately', (saved[0] as { enabled: boolean }).enabled === false);

await store.remove(sub);
await store.remove(noLabelSub);
check('deleting subscriptions removes them from the persisted list', saved.length === 0);
```

### A corrupted/hand-edited persisted subscription is dropped, not trusted as-is (research.md § load validation)

```ts
let invalidDataNotifiedCount: number | undefined;
const corruptedStore = createSubscriptionStore({
  load: async () => [
    { type: 'keyword', value: 'good one', label: 'Good', checkIntervalHours: 24, lastCheckedAt: null, enabled: true },
    { type: 'keyword', value: 'missing fields' }, // no label/checkIntervalHours/lastCheckedAt/enabled -- fails isValidSubscription
  ],
  save: async () => {},
  onInvalidData: (droppedCount) => { invalidDataNotifiedCount = droppedCount; },
});

check('the well-formed subscription still loads', corruptedStore.list().length === 1);
check('the malformed one is silently dropped, not thrown', corruptedStore.list()[0]?.value === 'good one');
check('onInvalidData reports exactly the one dropped record', invalidDataNotifiedCount === 1);
```

### Subscription storage never clobbers sibling PluginSettings (research.md Decision 15)

```ts
// Simulates the read-modify-write adapter T020 wires in src/main.ts.
let pluginData: { settings: { summarizationEnabled: boolean }; subscriptions: unknown[] } = {
  settings: { summarizationEnabled: true },
  subscriptions: [],
};

const rmwStore = createSubscriptionStore({
  load: async () => pluginData.subscriptions as never,
  save: async (subs) => { pluginData = { ...pluginData, subscriptions: subs }; },
});

await rmwStore.register({ type: 'keyword', value: 'test', label: 'Test' });
check('registering a subscription does not erase sibling settings', pluginData.settings.summarizationEnabled === true);
```

### Provider parsing (User Story 4)

```ts
const candidates = parseArxivAtom(SAMPLE_ATOM);
check('arXiv entry parses to one candidate', candidates.length === 1);
check('candidate has unknown citation data (never fabricated 0)', candidates[0]?.citationCount === undefined && candidates[0]?.references === undefined);
check('candidate sourceId is arxiv-scoped', candidates[0]?.sourceId === 'arxiv:2301.12345');
check('sourceId strips the arXiv version suffix (input was v1)', candidates[0]?.sourceId === 'arxiv:2301.12345' && !candidates[0]?.sourceId.includes('v1'));
```

### A directly-collected paper and a reference to it agree on sourceId (research.md Decision 9/13, graph edge matching for 006)

```ts
import { parseSemanticScholarPaper, toPaperSourceId } from '../src/collection/semanticScholarParser';

// Simulates a Semantic Scholar response citing the SAME paper as SAMPLE_ATOM (2301.12345),
// but with the reference's externalIds.ArXiv still carrying a version suffix, as if S2 had not stripped it.
const s2Paper = parseSemanticScholarPaper({
  paperId: 'other-paper',
  citationCount: 3,
  references: [{ externalIds: { ArXiv: '2301.12345v1' }, paperId: 's2-abc' }],
});

check(
  "a reference's sourceId matches the directly-collected paper's sourceId byte-for-byte, despite the version suffix",
  toPaperSourceId(s2Paper.references[0]!) === candidates[0]?.sourceId,
);
```

### arXiv query construction is UTC-safe and encoding-safe (research.md Decisions 18-19)

```ts
import { buildArxivSearchUrl } from '../src/collection/arxivClient';

// A date picked so a non-UTC host timezone would shift it to a different calendar day
// if local-timezone accessors were used by mistake (e.g. UTC+9 rolling 2023-01-01T00:00Z
// back to 2022-12-31 local time).
const windowStart = Date.UTC(2023, 0, 1, 0, 0, 0);
const windowEnd = Date.UTC(2023, 0, 2, 0, 0, 0);

const url = buildArxivSearchUrl(
  { type: 'keyword', value: 'graph neural network "attention"' },
  { from: windowStart, to: windowEnd },
  { start: 0, maxResults: 100 },
);

check('query date range uses UTC-formatted bounds (20230101/20230102), not shifted by local timezone', url.includes('20230101') && url.includes('20230102'));
check('embedded quote characters in the subscription value are stripped, not left to break the query', !decodeURIComponent(url).includes('""'));
check('the assembled query string is URL-encoded (no literal spaces in the URL)', !url.includes(' '));
check('results are pinned to submittedDate ascending order, never arXiv default relevance (FR-026)', url.includes('sortBy=submittedDate') && url.includes('sortOrder=ascending'));
```

### Promotion without enrichment (User Story 4 / Edge Cases)

```ts
const promoted = promote(candidates[0] as PaperCandidate);
check('candidate with a year is promoted, not held back', promoted !== undefined);
check('citationsKnown is false when unenriched', promoted?.citationsKnown === false);
check('citationCount defaults to 0, not fabricated', promoted?.citationCount === 0);
```

### Held-back candidate (Edge Cases)

```ts
const noYear: PaperCandidate = { ...candidates[0]!, publicationYear: undefined };
check('candidate missing a year is held back, not promoted', promote(noYear) === undefined);
```

### Enrichment is injectable, so it can be verified without a live network call (research.md Decision 36)

```ts
import type { EnrichmentOutcome } from '../src/collection/enrichment';

// A stub `enrich` — this is the DI seam Decision 36 added specifically so quickstart
// never needs a real Semantic Scholar call. Every runCollectionPass scenario below
// passes one of these as the 5th argument instead of relying on the real
// enrichFromSemanticScholar (which main.ts's production wiring uses by omitting this
// argument entirely and taking the default).
function stubEnrichNone(): (candidates: PaperCandidate[]) => Promise<Map<string, EnrichmentOutcome>> {
  return async (cands) => new Map(cands.map((c) => [c.sourceId, { status: 'terminalAbsence' as const }]));
}
function stubEnrichAll(citationCount: number, references: string[]): (candidates: PaperCandidate[]) => Promise<Map<string, EnrichmentOutcome>> {
  return async (cands) => new Map(cands.map((c) => [c.sourceId, { status: 'enriched' as const, citationCount, references: references as never[] }]));
}
```

### A successful enrichment outcome, once applied to its candidate, promotes with citationsKnown = true — verified end-to-end through runCollectionPass (FR-018, research.md Decision 33's apply-before-promote step)

```ts
let enrichedPersisted: Paper | undefined;
async function* enrichedOne(): AsyncIterable<PaperCandidate> {
  yield candidates[0] as PaperCandidate;
}

await runCollectionPass(enrichedOne(), {
  persist: async (paper: Paper) => { enrichedPersisted = paper; },
  alreadyPersisted: async () => false,
}, () => false, () => undefined, stubEnrichAll(7, ['arxiv:2109.00001']));

check('a candidate enriched via the injected stub is persisted with citationsKnown = true', enrichedPersisted?.citationsKnown === true);
check('a candidate enriched via the injected stub carries through the real citation count', enrichedPersisted?.citationCount === 7);

// Contrast: the same candidate with a "not enriched" outcome (terminalAbsence) still
// persists (never held back), but with citationsKnown = false — this is what "forgetting
// to apply the outcome" would look like if the apply step (Decision 33) were skipped.
let unenrichedPersisted: Paper | undefined;
await runCollectionPass(enrichedOne(), {
  persist: async (paper: Paper) => { unenrichedPersisted = paper; },
  alreadyPersisted: async () => false,
}, () => false, () => undefined, stubEnrichNone());

check('a candidate with a terminalAbsence outcome persists with citationsKnown = false, not held back', unenrichedPersisted?.citationsKnown === false);
```

### Deduplication across two subscriptions (User Story 2, Acceptance Scenario 3)

```ts
let persistedCount = 0;
async function* twice(): AsyncIterable<PaperCandidate> {
  yield candidates[0] as PaperCandidate;
  yield candidates[0] as PaperCandidate; // same sourceId, discovered via a second subscription
}

await runCollectionPass(twice(), {
  persist: async (_paper: Paper) => { persistedCount += 1; },
  alreadyPersisted: async () => false,
}, () => false, () => undefined, stubEnrichNone());

check('duplicate sourceId processed only once', persistedCount === 1);
```

### Catch-up window for a brand-new subscription (User Story 3, Clarification 2026-07-05)

```ts
import { computeCollectionWindow } from '../src/collection/scheduler';

const now = Date.now();
const brandNewWindow = computeCollectionWindow({ lastCheckedAt: null }, now);
check('new subscription look-back is bounded to exactly 24h, not unbounded, and NOT widened by the announcement-lag overlap (FR-030 unmodified by FR-041)', now - brandNewWindow.from === 24 * 60 * 60 * 1000);

const existingWindow = computeCollectionWindow({ lastCheckedAt: now - 100_000 }, now);
check('existing subscription catch-up window starts at lastCheckedAt', existingWindow.from === now - 100_000);

// Re-enabling a long-disabled subscription keeps catch-up semantics (FR-029): because
// lastCheckedAt did not advance while disabled, the window spans the whole disabled span.
const reEnabledWindow = computeCollectionWindow({ lastCheckedAt: now - 30 * 24 * 60 * 60 * 1000 }, now);
check('a re-enabled subscription catches up over the whole disabled period, not from now', reEnabledWindow.from === now - 30 * 24 * 60 * 60 * 1000);
```

### Summarization failure does not block persistence, and the summary reaches persist() (FR-017, research.md Decision 22)

```ts
let persisted: Paper | undefined;
let persistedSummary: { summary: string; futureDirections: string } | undefined;
async function* one(): AsyncIterable<PaperCandidate> {
  yield candidates[0] as PaperCandidate;
}

await runCollectionPass(one(), {
  summarize: async () => { throw new Error('LLM timeout'); },
  persist: async (paper: Paper, summary) => { persisted = paper; persistedSummary = summary; },
  alreadyPersisted: async () => false,
}, () => true, () => undefined, stubEnrichNone());

check('paper is still persisted after a summarization failure', persisted !== undefined);
check('a failed summarization reaches persist() as undefined, not silently omitted from the call', persistedSummary === undefined);

// Now confirm a SUCCESSFUL summarize() result actually reaches persist() — this is exactly
// the bug an earlier draft of this contract had (summarize's result had nowhere to go).
let receivedSummary: { summary: string; futureDirections: string } | undefined;
let summarizeReceivedFullPaperFields = false;
await runCollectionPass(one(), {
  summarize: async (input) => {
    // input must be exactly {title, abstract, citationCount, citationsKnown} — never sourceId/references/authors.
    summarizeReceivedFullPaperFields = 'sourceId' in input || 'references' in input || 'authors' in input;
    return { summary: 'A short summary.', futureDirections: 'Possible next steps.' };
  },
  persist: async (_paper: Paper, summary) => { receivedSummary = summary; },
  alreadyPersisted: async () => false,
}, () => true, () => undefined, stubEnrichNone());

check('summarize() receives only the four narrowed fields, never the full Paper', !summarizeReceivedFullPaperFields);
check("a successful summarize() result is passed through to persist()'s second argument", receivedSummary?.summary === 'A short summary.');
```

### Changing an existing subscription's check interval (User Story 1, Acceptance Scenario 4 / FR-002)

```ts
const rejected = await store.setCheckInterval(sub, 1); // 1 is not one of 6/12/24/48/72
check('disallowed interval rejected, prior value kept', rejected === sub.checkIntervalHours);

const accepted = await store.setCheckInterval(sub, 72);
check('allowed interval accepted', accepted === 72);
```

### Provider failure surfaces a notice and does not advance lastCheckedAt (FR-012)

```ts
import { startScheduler } from '../src/collection/scheduler';

let notified = false;
let recordedThrough: number | undefined;

await startScheduler(/* plugin stub */ {} as never, {
  getSubscriptions: () => [{ ...sub, lastCheckedAt: null, enabled: true }],
  runCheck: async () => { throw new Error('arXiv unreachable'); },
  onSubscriptionChecked: async (_s, checkedThrough) => { recordedThrough = checkedThrough; },
  onFailure: () => { notified = true; },
});

check('a provider failure surfaces a user-facing notice', notified === true);
check('lastCheckedAt is not advanced past a failed window', recordedThrough === undefined);
```

### A repeated failure for the same subscription notifies once, not on every retry (FR-012a)

```ts
let repeatFailNotifyCount = 0;
const flakySub = { ...sub, type: 'keyword' as const, value: 'flaky-provider', lastCheckedAt: null, enabled: true };

const repeatFailHandle = await startScheduler(/* plugin stub */ { registerInterval: (h: number) => h } as never, {
  getSubscriptions: () => [flakySub],
  runCheck: async () => { throw new Error('arXiv unreachable'); }, // fails on every call
  onSubscriptionChecked: async () => {},
  onFailure: () => { repeatFailNotifyCount += 1; },
});
// The catch-up pass above already produced the first failure notice.
await repeatFailHandle.checkNow(flakySub); // simulates a later retry (e.g. the next 15-min tick)
await repeatFailHandle.checkNow(flakySub); // and another

check('a subscription failing repeatedly notifies exactly once, not once per retry', repeatFailNotifyCount === 1);
```

### A subscription is never checked twice concurrently (research.md Decision 14)

```ts
let concurrentRunCheckCalls = 0;
let maxConcurrentRunCheckCalls = 0;

const slowSub = { ...sub, lastCheckedAt: null, enabled: true };

await startScheduler(/* plugin stub */ {} as never, {
  getSubscriptions: () => [slowSub],
  runCheck: async () => {
    concurrentRunCheckCalls += 1;
    maxConcurrentRunCheckCalls = Math.max(maxConcurrentRunCheckCalls, concurrentRunCheckCalls);
    await new Promise((resolve) => setTimeout(resolve, 50)); // simulates a slow catch-up pass
    concurrentRunCheckCalls -= 1;
    return { truncated: false, coveredThrough: Date.now() };
  },
  onSubscriptionChecked: async () => {},
  // A second trigger (e.g. a recurring tick) fires while the first runCheck above is still pending.
});

check('the same subscription is never mid-flight in two overlapping runCheck calls', maxConcurrentRunCheckCalls === 1);
```

### No collection after the scheduler stops (SC-003)

```ts
// HONEST LIMITATION: this quickstart script runs via plain Node with no real Obsidian host,
// so it cannot literally exercise Obsidian's onunload clearing a registerInterval-registered
// timer — that teardown is Obsidian's own guarantee, not this feature's code, and can only be
// confirmed by manually installing the built plugin, toggling it off, and watching no further
// requests fire (see CLAUDE.md's manual-test instructions). What THIS script can and does
// verify is the positive half of SC-003's contract: startScheduler never reaches for a raw
// `setInterval` of its own — every interval it creates is wrapped in the SAME `registerInterval`
// call this stub records, so there is exactly one thing for Obsidian's teardown to clear.
let registerIntervalCalls = 0;
const stubPlugin = {
  registerInterval: (handle: number) => { registerIntervalCalls += 1; return handle; },
} as never;

const liveSub = { ...sub, type: 'keyword' as const, value: 'stop-test', lastCheckedAt: null, enabled: true };
let runCheckCalls = 0;

await startScheduler(stubPlugin, {
  getSubscriptions: () => [liveSub],
  runCheck: async () => { runCheckCalls += 1; return { truncated: false, coveredThrough: Date.now() }; },
  onSubscriptionChecked: async () => {},
});

check('startScheduler registers its recurring tick through registerInterval exactly once (nothing bypasses it for Obsidian to miss on unload)', registerIntervalCalls === 1);
check('with a real, enabled subscription present, the catch-up pass actually invokes runCheck (the wiring this feature depends on for SC-003 to matter at all)', runCheckCalls === 1);
```

### Settings are read live, and a stale in-flight summary is discarded (FR-021, research.md Decision 26)

```ts
let liveEnabled = true;
let discardPersistedSummary: { summary: string; futureDirections: string } | undefined = { summary: 'placeholder', futureDirections: 'placeholder' };

async function* oneMore(): AsyncIterable<PaperCandidate> {
  yield candidates[0] as PaperCandidate;
}

await runCollectionPass(oneMore(), {
  summarize: async () => {
    // The setting flips to disabled WHILE summarization is in flight.
    liveEnabled = false;
    return { summary: 'generated after toggle-off', futureDirections: 'n/a' };
  },
  persist: async (_paper: Paper, summary) => { discardPersistedSummary = summary; },
  alreadyPersisted: async () => false,
}, () => liveEnabled, () => undefined, stubEnrichNone());

check('a summary generated after summarization was toggled off mid-flight is discarded, not persisted', discardPersistedSummary === undefined);
```

### Two due subscriptions in the same tick are checked sequentially, never concurrently (FR-022, research.md Decision 27)

```ts
let sequentialActive = 0;
let sequentialMaxActive = 0;
const subA = { ...sub, type: 'keyword' as const, value: 'a', lastCheckedAt: null, enabled: true };
const subB = { ...sub, type: 'keyword' as const, value: 'b', lastCheckedAt: null, enabled: true };

await startScheduler(/* plugin stub */ {} as never, {
  getSubscriptions: () => [subA, subB],
  runCheck: async () => {
    sequentialActive += 1;
    sequentialMaxActive = Math.max(sequentialMaxActive, sequentialActive);
    await new Promise((resolve) => setTimeout(resolve, 20));
    sequentialActive -= 1;
    return { truncated: false, coveredThrough: Date.now() };
  },
  onSubscriptionChecked: async () => {},
});

check('two subscriptions due in the same tick are never mid-flight together', sequentialMaxActive === 1);
```

### A single malformed arXiv entry is skipped without failing the batch (FR-023, research.md Decision 28)

```ts
const MIXED_ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.00001v1</id>
    <title>Missing a summary element entirely</title>
    <author><name>Ada Lovelace</name></author>
    <published>2023-01-15T00:00:00Z</published>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2301.00002v1</id>
    <title>A Well-Formed Paper</title>
    <author><name>Grace Hopper</name></author>
    <published>2023-01-16T00:00:00Z</published>
    <summary>An abstract.</summary>
  </entry>
</feed>`;

const mixedCandidates = parseArxivAtom(MIXED_ATOM);
check('the malformed entry is skipped, not thrown, and the well-formed one still parses', mixedCandidates.length === 1 && mixedCandidates[0]?.sourceId === 'arxiv:2301.00002');
```

### The frontier window is unaffected by FR-041; the lag re-scan is a wholly separate window (FR-041, research.md Decision 38)

```ts
import { computeLagOverlapWindow } from '../src/collection/scheduler';

// The frontier window (computeCollectionWindow) is EXACTLY what it was before FR-041 existed —
// no lag term, no coveredFrom parameter at all. This is what drives lastCheckedAt.
const preCheckSub = { lastCheckedAt: now - 10 * 60 * 1000, coveredFrom: null };
const frontierOnly = computeCollectionWindow(preCheckSub, now);
check(
  'the frontier window is exactly [lastCheckedAt, now] — FR-041 does not widen it',
  frontierOnly.from === preCheckSub.lastCheckedAt && frontierOnly.to === now,
);

// The lag re-scan is a SEPARATE window, computed from the already-computed frontierOnly window
// (not from a fresh read of subscription.lastCheckedAt).
const lagWindow = computeLagOverlapWindow(frontierOnly, preCheckSub, now);
check(
  "the lag re-scan window reaches at least 4 days into the past, ending at the frontier window's own from (not now) — it re-covers already-checked history, catching arXiv papers not yet announced when the prior check ran",
  lagWindow !== undefined && frontierOnly.from - lagWindow.from >= 4 * 24 * 60 * 60 * 1000 - 1000 && lagWindow.to === frontierOnly.from,
);

// The lag re-scan must not cross below the subscription's own backward floor (coveredFrom) —
// that territory belongs to backfill.
const flooredSub = { lastCheckedAt: now - 10 * 60 * 1000, coveredFrom: now - 6 * 60 * 60 * 1000 }; // floor only 6h back
const lagClampedByFloor = computeLagOverlapWindow(computeCollectionWindow(flooredSub, now), flooredSub, now);
check(
  'the lag re-scan is clamped at coveredFrom, never reaching further back than the backward floor',
  lagClampedByFloor !== undefined && lagClampedByFloor.from === now - 6 * 60 * 60 * 1000,
);

// A subscription's first check and a clock-backward check have no lag re-scan at all.
const firstCheckSub = { lastCheckedAt: null, coveredFrom: null };
check(
  "no lag re-scan on a subscription's first check (nothing already-checked to re-scan)",
  computeLagOverlapWindow(computeCollectionWindow(firstCheckSub, now), firstCheckSub, now) === undefined,
);
const backwardSub = { lastCheckedAt: now + 1000, coveredFrom: null };
check(
  'no lag re-scan on a clock-backward check',
  computeLagOverlapWindow(computeCollectionWindow(backwardSub, now), backwardSub, now) === undefined,
);
```

### The lag re-scan is anchored to the frontier window actually used, immune to lastCheckedAt having already advanced by the time it's computed (FR-041, research.md Decision 39 — the fix for a stale-vs-fresh-object ambiguity)

```ts
// Simulates the real tick-processing order: window/lagWindow computed FIRST, from one snapshot;
// only afterward does a (simulated) recordChecked advance lastCheckedAt — mirroring
// onSubscriptionChecked firing before the lag re-scan is issued.
const preAdvanceSub = { lastCheckedAt: now - 30 * 24 * 60 * 60 * 1000, coveredFrom: now - 60 * 24 * 60 * 60 * 1000 }; // 30 days stale, e.g. after a long off-period
const capturedFrontierWindow = computeCollectionWindow(preAdvanceSub, now);
const capturedLagWindow = computeLagOverlapWindow(capturedFrontierWindow, preAdvanceSub, now);

// Now simulate lastCheckedAt having been advanced by the frontier check's own recordChecked —
// as it would be by the time a naive implementation might (wrongly) recompute the lag window.
const postAdvanceSub = { ...preAdvanceSub, lastCheckedAt: now };

check(
  "the CAPTURED lag window (computed upfront, per the correct design) still targets the pre-check span — the one that actually needed re-scanning — not a collapsed near-now span",
  capturedLagWindow !== undefined && capturedLagWindow.to === preAdvanceSub.lastCheckedAt,
);
check(
  'a naive re-computation against the POST-advance subscription would have produced a materially different (wrong) window — this is exactly the bug Decision 39 closes by making frontierWindow a required parameter',
  computeLagOverlapWindow(computeCollectionWindow(postAdvanceSub, now), postAdvanceSub, now)!.to !== capturedLagWindow!.to,
);
```

### A high-volume subscription's frontier query keeps advancing even when its lag re-scan is truncated every check (FR-041, research.md Decision 38 — the livelock this design specifically avoids)

```ts
let frontierCalls = 0;
let lagCalls = 0;
let lastRecordedThrough: number | undefined;
const busySub = { ...sub, type: 'keyword' as const, value: 'busy-category', lastCheckedAt: now - 6 * 60 * 60 * 1000, coveredFrom: now - 30 * 24 * 60 * 60 * 1000, enabled: true };

await startScheduler(/* plugin stub */ { registerInterval: (h: number) => h } as never, {
  getSubscriptions: () => [busySub],
  runCheck: async (_s, window) => {
    // Simulate: the frontier window ([lastCheckedAt, now], narrow) always fully covers; the
    // lag window (wide, ~4 days) always truncates far short of its own `to` — as a real
    // high-volume category's paging cap would force.
    const isLagWindow = window.to === busySub.lastCheckedAt;
    if (isLagWindow) {
      lagCalls += 1;
      return { truncated: true, coveredThrough: window.from }; // no progress at all, every time
    }
    frontierCalls += 1;
    return { truncated: false, coveredThrough: window.to };
  },
  onSubscriptionChecked: async (_s, checkedThrough) => { lastRecordedThrough = checkedThrough; },
});

check('the frontier query still ran once (separately from the lag re-scan)', frontierCalls === 1);
check('the lag re-scan also ran once, and its permanent truncation did not throw or block the frontier', lagCalls === 1);
check(
  "lastCheckedAt was recorded from the frontier's own coveredThrough (== now), never affected by the lag re-scan's total non-progress — this is what prevents the livelock a single combined query would suffer",
  lastRecordedThrough === now,
);
```

### A clock that has moved backward clamps to an empty window, never an inverted range (FR-024, research.md Decision 29)

```ts
const backwardsNow = now - 200_000; // "now" has moved backward past lastCheckedAt
const clampedWindow = computeCollectionWindow({ lastCheckedAt: now - 100_000 }, backwardsNow);
check('a clock moving backward produces an empty window, not an inverted one, and is NOT widened by the announcement-lag overlap (FR-024 takes precedence over FR-041)', clampedWindow.from === backwardsNow && clampedWindow.to === backwardsNow);
```

### Registering a subscription with an empty or whitespace-only value is rejected (FR-025, research.md Decision 30)

```ts
let emptyValueRejected = false;
try {
  await store.register({ type: 'keyword', value: '   ' });
} catch {
  emptyValueRejected = true;
}
check('registering a whitespace-only subscription value throws and creates nothing', emptyValueRejected === true);
```

### A truncated window advances lastCheckedAt only to the covered boundary, not to now (FR-026, research.md Decision 32)

```ts
const truncNow = Date.now();
const coveredBoundary = truncNow - 5 * 60 * 60 * 1000; // newest paper actually fetched, 5h ago
let truncRecordedThrough: number | undefined;
let truncNotified = false;

await startScheduler(/* plugin stub */ {} as never, {
  getSubscriptions: () => [{ ...sub, lastCheckedAt: truncNow - 90 * 24 * 60 * 60 * 1000, enabled: true }],
  runCheck: async () => ({ truncated: true, coveredThrough: coveredBoundary }),
  onSubscriptionChecked: async (_s, checkedThrough) => { truncRecordedThrough = checkedThrough; },
  onFailure: () => { truncNotified = true; },
  now: () => truncNow,
});

check('a truncated window still records lastCheckedAt — at the covered boundary, not now', truncRecordedThrough === coveredBoundary);
check('a truncated window does NOT advance lastCheckedAt to now (the uncovered tail is picked up next check)', truncRecordedThrough !== truncNow);
check('a truncated window still surfaces the FR-014 notice', truncNotified === true);
```

### Registering a genuinely new subscription triggers an immediate check; re-registering does not (FR-028, research.md Decision 34)

```ts
const registered: string[] = [];
const immediateStore = createSubscriptionStore({
  load: async () => [],
  save: async () => {},
  onRegistered: (s) => { registered.push(s.value); },
});

await immediateStore.register({ type: 'keyword', value: 'diffusion models' });
check('onRegistered fires once for a genuinely new subscription', registered.length === 1 && registered[0] === 'diffusion models');

await immediateStore.register({ type: 'keyword', value: 'diffusion models' }); // idempotent hit
check('onRegistered does NOT fire again for an idempotent re-registration', registered.length === 1);
```

### `startScheduler`'s returned `checkNow` handle actually runs a check immediately, and no-ops for a disabled subscription (FR-028, research.md Decision 34)

```ts
let checkNowRunCheckCalls = 0;
const checkNowEnabledSub = { ...sub, type: 'keyword' as const, value: 'check-now-enabled', lastCheckedAt: null, enabled: true };
const checkNowDisabledSub = { ...sub, type: 'keyword' as const, value: 'check-now-disabled', lastCheckedAt: null, enabled: false };

const schedulerHandle = await startScheduler(/* plugin stub */ { registerInterval: (h: number) => h } as never, {
  getSubscriptions: () => [checkNowEnabledSub, checkNowDisabledSub],
  runCheck: async () => { checkNowRunCheckCalls += 1; return { truncated: false, coveredThrough: Date.now() }; },
  onSubscriptionChecked: async () => {},
});

const callsAfterCatchUp = checkNowRunCheckCalls; // the catch-up pass above already checked the enabled one once

await schedulerHandle.checkNow(checkNowEnabledSub);
check('checkNow runs a check immediately for an enabled subscription, without waiting for a tick', checkNowRunCheckCalls === callsAfterCatchUp + 1);

await schedulerHandle.checkNow(checkNowDisabledSub);
check('checkNow is a no-op for a disabled subscription', checkNowRunCheckCalls === callsAfterCatchUp + 1);
```

### HONEST LIMITATION: SC-013's batch-chunking count is not exercised here

Every `runCollectionPass` scenario above passes a stub `enrich` function (`stubEnrichNone`/
`stubEnrichAll`) instead of the real `enrichFromSemanticScholar`/`fetchSemanticScholarBatch`
(research.md Decision 36's DI seam exists specifically so this script never fires a live
request). That means SC-013's actual claim — enriching N candidates issues at most
⌈N / 500⌉ requests, chunked, never one request per paper — is never exercised by this
script; only the *shape* of an enrichment outcome (`enriched`/`terminalAbsence`/
`transientFailure`) and its apply-then-promote effect are verified. Confirming the chunking
count itself requires either a live Semantic Scholar call (out of scope for this
no-live-network script) or a mock `requestUrl`/fetch layer this repo does not have
(no test runner is configured — see `research.md` § 1). This is a real, currently-unclosed
coverage gap for SC-013, not a documentation inconsistency.

## Expected outcome

All `PASS` lines, zero `FAIL` lines. Delete the `scratch/` directory afterward — it is a manual verification aid, not shipped code.

## Cleanup

```bash
rm -rf scratch/
```
