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
});
check('paper with known year becomes valid Paper', withYear !== undefined && isValidPaper(withYear));

const withoutYear = toPaper({
  title: 'Some Preprint', publicationYear: undefined,
  authors: [], citationCount: 0, abstract: '',
  sourceId: 'arxiv:9999.99999',
});
check('paper with unknown year is held back (undefined), not created', withoutYear === undefined);

check('sourceId encodes provider', isPaperSourceId('arxiv:1706.03762') && isPaperSourceId('semanticScholar:abc123'));
check('malformed sourceId rejected', !isPaperSourceId('1706.03762'));
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
