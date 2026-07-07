# Quickstart: Validating the Core Data Structures

Purpose: prove the `src/models/` types and validators behave as `spec.md`'s acceptance scenarios and success criteria require, without adding a test framework (see `research.md` § 1). This is a manual, repeatable validation script — not part of the plugin bundle.

## Prerequisites

- `npm install` has been run (esbuild devDependency present).
- `src/models/subscription.ts`, `src/models/paper.ts`, `src/models/settings.ts` exist and `npm run build` passes (`tsc --noEmit` clean).

## Setup

Create a scratch file (not committed) that imports the three modules and asserts against the scenarios below, e.g. `scratch/verify-models.ts`:

```ts
import { isValidSubscription, assignCheckInterval, DEFAULT_CHECK_INTERVAL_HOURS } from '../src/models/subscription';
import { toPaper, isValidPaper, isPaperSourceId } from '../src/models/paper';
import { DEFAULT_PLUGIN_SETTINGS, isValidPluginSettings } from '../src/models/settings';

function check(label: string, ok: boolean) {
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`);
}
```

## Run

```bash
npx esbuild scratch/verify-models.ts --bundle --platform=node --outfile=scratch/verify-models.js
node scratch/verify-models.js
```

## Scenarios to assert (maps to `spec.md` Acceptance Scenarios)

### Subscription (User Story 1)

```ts
check('valid subscription accepted', isValidSubscription({
  type: 'keyword', value: 'graph neural network', label: 'GNN', 
  checkIntervalHours: 24, lastCheckedAt: null, enabled: true,
}));

check('missing field rejected', !isValidSubscription({
  type: 'keyword', value: 'x', label: 'X', checkIntervalHours: 24, enabled: true, // lastCheckedAt missing
}));

check('disallowed interval not accepted, prior value kept', 
  assignCheckInterval(24, 1) === 24);

check('allowed interval accepted', assignCheckInterval(24, 72) === 72);
```

### Paper (User Story 2)

```ts
const withYear = toPaper({
  title: 'Attention Is All You Need', publicationYear: 2017,
  authors: ['Vaswani'], citationCount: 100000, abstract: '...',
  sourceId: 'arxiv:1706.03762',
  references: ['arxiv:1409.0473'], // outbound citations (FR-016 field); empty [] is also valid
  embedding: undefined, embeddingModel: undefined, embeddingSource: undefined, // not computed yet (FR-019)
});
check('paper with known year becomes valid Paper', withYear !== undefined && isValidPaper(withYear));

const withoutYear = toPaper({
  title: 'Some Preprint', publicationYear: undefined,
  authors: [], citationCount: 0, abstract: '',
  sourceId: 'arxiv:9999.99999',
  references: [],
  embedding: undefined, embeddingModel: undefined, embeddingSource: undefined,
});
check('paper with unknown year is held back (undefined), not created', withoutYear === undefined);

check('sourceId encodes provider', isPaperSourceId('arxiv:1706.03762') && isPaperSourceId('semanticScholar:abc123'));
check('malformed sourceId rejected', !isPaperSourceId('1706.03762'));

// references must be an array of valid sourceIds (empty allowed); a bad element invalidates the paper
check('paper with a non-sourceId reference is rejected', !isValidPaper({
  title: 't', publicationYear: 2017, authors: [], citationCount: 0, citationsKnown: true, abstract: '',
  sourceId: 'arxiv:1', references: ['not-a-sourceid'],
  embedding: null, embeddingModel: null, embeddingSource: null,
}));

// citationsKnown (FR-018): missing citation data never holds a paper back — it is promoted
// immediately with citationCount 0 and citationsKnown = false, distinguishing "unknown" from
// a confirmed zero (which has citationsKnown = true).
const enrichedUnknown = toPaper({
  title: 'arXiv-only preprint', publicationYear: 2024,
  authors: [], citationCount: undefined, abstract: '',
  sourceId: 'arxiv:2401.00001', references: undefined,
  embedding: undefined, embeddingModel: undefined, embeddingSource: undefined,
});
check('paper promoted without citation data is NOT held back', enrichedUnknown !== undefined);
check('citationsKnown is false when citation data was never fetched', enrichedUnknown?.citationsKnown === false);

const confirmedUncited = toPaper({
  title: 'Confirmed uncited paper', publicationYear: 2024,
  authors: [], citationCount: 0, abstract: '',
  sourceId: 'arxiv:2401.00002', references: [],
  embedding: undefined, embeddingModel: undefined, embeddingSource: undefined,
});
check('citationsKnown is true when citation data was actually fetched', confirmedUncited?.citationsKnown === true);

check('paper missing citationsKnown is rejected', !isValidPaper({
  title: 't', publicationYear: 2017, authors: [], citationCount: 0, abstract: '',
  sourceId: 'arxiv:1', references: [], embedding: null, embeddingModel: null, embeddingSource: null,
}));

// content embedding (FR-019/FR-021): a promoted paper carries embedding fields; a pending (null)
// embedding is still valid and never holds a paper back — the vector is filled later by 260702-002.
check('paper promoted with a pending (null) embedding is still valid',
  withYear !== undefined && withYear.embedding === null && isValidPaper(withYear));

check('a populated embedding is accepted', isValidPaper({
  title: 't', publicationYear: 2017, authors: [], citationCount: 0, citationsKnown: true, abstract: '',
  sourceId: 'arxiv:1', references: [],
  embedding: [0.1, 0.2, 0.3], embeddingModel: 'bge-small-en-v1.5', embeddingSource: 'local',
}));

check('a non-array embedding is rejected', !isValidPaper({
  title: 't', publicationYear: 2017, authors: [], citationCount: 0, citationsKnown: true, abstract: '',
  sourceId: 'arxiv:1', references: [],
  embedding: 'nope' as any, embeddingModel: null, embeddingSource: null,
}));
```

### Plugin Settings (User Story 3)

```ts
check('default settings are complete and valid', isValidPluginSettings(DEFAULT_PLUGIN_SETTINGS));
check('default storage location is concrete and non-empty', DEFAULT_PLUGIN_SETTINGS.storageLocation.length > 0);
check('summarization defaults off', DEFAULT_PLUGIN_SETTINGS.summarizationEnabled === false);
```

## Expected outcome

All `PASS` lines, zero `FAIL` lines. Delete the `scratch/` directory afterward — it is a manual verification aid, not shipped code.

## Cleanup

```bash
rm -rf scratch/
```
