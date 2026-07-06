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

### Subscription storage never clobbers sibling PluginSettings (research.md Decision 15)

```ts
// Simulates the read-modify-write adapter T019 wires in src/main.ts.
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
}, false);

check('duplicate sourceId processed only once', persistedCount === 1);
```

### Catch-up window for a brand-new subscription (User Story 3, Clarification 2026-07-05)

```ts
import { computeCollectionWindow } from '../src/collection/scheduler';

const now = Date.now();
const brandNewWindow = computeCollectionWindow({ lastCheckedAt: null }, now);
check('new subscription look-back is bounded to 24h, not unbounded', now - brandNewWindow.from === 24 * 60 * 60 * 1000);

const existingWindow = computeCollectionWindow({ lastCheckedAt: now - 100_000 }, now);
check('existing subscription catch-up window starts at lastCheckedAt', existingWindow.from === now - 100_000);
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
}, true);

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
}, true);

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
  },
  onSubscriptionChecked: async () => {},
  // A second trigger (e.g. a recurring tick) fires while the first runCheck above is still pending.
});

check('the same subscription is never mid-flight in two overlapping runCheck calls', maxConcurrentRunCheckCalls === 1);
```

### No collection after the scheduler stops (SC-003)

```ts
let callsAfterStop = 0;
const stubPlugin = { registerInterval: (handle: number) => handle } as never;

await startScheduler(stubPlugin, {
  getSubscriptions: () => [],
  runCheck: async () => { callsAfterStop += 1; },
  onSubscriptionChecked: async () => {},
});

// Simulate onunload: Obsidian clears every interval registered via registerInterval.
// No task in this feature re-registers a raw setInterval, so nothing should fire afterward.
check('no further collection call fires once the scheduler is torn down', callsAfterStop === 0);
```

## Expected outcome

All `PASS` lines, zero `FAIL` lines. Delete the `scratch/` directory afterward — it is a manual verification aid, not shipped code.

## Cleanup

```bash
rm -rf scratch/
```
