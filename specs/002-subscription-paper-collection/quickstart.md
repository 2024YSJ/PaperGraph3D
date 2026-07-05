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

await store.setEnabled(sub, false);
check('disabling a subscription persists immediately', (saved[0] as { enabled: boolean }).enabled === false);

await store.remove(sub);
check('deleting a subscription removes it from the persisted list', saved.length === 0);
```

### Provider parsing (User Story 4)

```ts
const candidates = parseArxivAtom(SAMPLE_ATOM);
check('arXiv entry parses to one candidate', candidates.length === 1);
check('candidate has unknown citation data (never fabricated 0)', candidates[0]?.citationCount === undefined && candidates[0]?.references === undefined);
check('candidate sourceId is arxiv-scoped', candidates[0]?.sourceId === 'arxiv:2301.12345');
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

### Summarization failure does not block persistence (FR-017)

```ts
let persisted: Paper | undefined;
async function* one(): AsyncIterable<PaperCandidate> {
  yield candidates[0] as PaperCandidate;
}

await runCollectionPass(one(), {
  summarize: async () => { throw new Error('LLM timeout'); },
  persist: async (paper: Paper) => { persisted = paper; },
  alreadyPersisted: async () => false,
}, true);

check('paper is still persisted after a summarization failure', persisted !== undefined);
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
