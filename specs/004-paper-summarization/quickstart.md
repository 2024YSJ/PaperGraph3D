# Quickstart: Validating Paper Summarization & Future-Directions Text

Purpose: prove `src/services/summarization/` behaves as `spec.md`'s acceptance scenarios require, **without** a test framework and **without** any live network call — by driving `createSummarizeHook`/`llmEmbeddingUpgrade` (see `contracts/summarization-api.md`) against stubbed `SummarizationProvider`/`LlmEmbeddingProvider` implementations that resolve or reject in-process. `providers/openai.ts` itself (the only code that actually calls `requestUrl`) is verified separately by the manual in-vault smoke at the end.

## Prerequisites

- `npm install` has been run (esbuild devDependency present).
- `src/services/summarization/*.ts` exist and `npm run build` passes (`tsc --noEmit` clean).
- The 002 seams this feature completes are present: `src/collection/types.ts` (`SummarizationInput`/`SummaryResult`/`PipelineHooks`), `src/collection/embeddingUpgrade.ts` (`EmbeddingConfig`, `case 'llm'`), `src/collection/reembed.ts` (`isCanonical()`).

## Setup

Create a scratch file (not committed), e.g. `scratch/verify-summarization.ts`, that constructs fake `SummarizationProvider`/`LlmEmbeddingProvider` implementations — each a plain object whose `generate`/`embed` method is a function you control per-scenario (immediate resolve, immediate reject, or a `setTimeout`/never-resolve to exercise the timeout path) — and drives `createSummarizeHook`/`llmEmbeddingUpgrade` against them. Reference `contracts/summarization-api.md` for the exact signatures; keep helpers minimal:

```ts
// Obsidian provides `window` as a global at runtime; plain Node does not, and
// generate.ts's withTimeout() uses window.setTimeout/clearTimeout (the same
// window.setTimeout convention already used throughout src/collection/*.ts). This
// polyfill exists only so the scratch script can run under plain `node`.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;

import { createSummarizeHook } from '../src/services/summarization/hook';
import { llmEmbeddingUpgrade } from '../src/services/summarization/embeddingHook';
import type { SummarizationProvider, LlmEmbeddingProvider } from '../src/services/summarization/types';
// ...construct fake providers per contracts/summarization-api.md...

function check(label: string, ok: boolean) { console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}`); }
```

`embeddingHook.ts`'s default config statically imports `providers/openai.ts`, which imports the `obsidian` package (types-only, no runtime module — `requestUrl` cannot execute outside Obsidian). Since every scenario above overrides `getProvider` with a fake, `requestUrl` is never actually called, but the import still needs to *resolve* to bundle. Alias it to a two-line stub (`export function requestUrl(): never { throw new Error(...) }`) rather than touching real network code:

## Run

```bash
npx esbuild scratch/verify-summarization.ts --bundle --platform=node --format=esm \
	--alias:obsidian=./scratch/obsidian-stub.ts --outfile=scratch/verify-summarization.mjs
node scratch/verify-summarization.mjs
rm -rf scratch
```

(`--format=esm` and the `.mjs` output extension are required because `package.json` has `"type": "module"` — a plain `.js` output would be loaded as ESM anyway and fail on a CJS `require`.)

## Scenarios to assert (maps to `spec.md`)

### Opt-in summary generation (US1)

- **Disabled/unconfigured → undefined, no call attempted** (FR-001/FR-006): `getProvider` returns `undefined` (or `getCredential` returns `undefined`) → `createSummarizeHook(...)(input)` resolves `undefined`; the fake provider's `generate` is never invoked.
- **Success** (FR-002/SC-001): fake `generate` resolves `{ summary: '<40+ chars>' }` → hook resolves `{ summary, futureDirections: '' }` for a cited paper (`citationsKnown: true, citationCount: 5`).
- **Empty/too-short summary → fallback** (FR-007, data-model.md §2 threshold): fake `generate` resolves `{ summary: 'too short' }` (< 20 trimmed chars) → hook resolves `undefined` (caller falls back to the abstract, never a partial/garbled summary).
- **Timeout → fallback** (FR-007/FR-012, research.md §11): fake `generate` never resolves within the 20s bound (simulate by asserting the `AbortSignal` passed in fires, rather than waiting the full 20s in the scratch script) → hook resolves `undefined`.
- **Provider rejects (network/non-2xx) → fallback** (FR-007): fake `generate` rejects with a generic error → hook resolves `undefined`, no unhandled rejection escapes.
- **Invalid credentials → fallback + notification** (FR-008): fake `generate` rejects in a way `generate.ts` classifies `invalid-credentials` → hook resolves `undefined` **and** `notifyCredentialProblem` is called exactly once with a message.
- **In-flight discard on toggle-off** (spec Edge Cases): if the hook is invoked and `summarizationEnabled` flips off mid-flight (simulated by the fake provider checking a closure flag before resolving), the eventual resolution is still `undefined` — never a stale summary applied after the feature was disabled.
- **Generated text never touches user-authored content** (SC-004): assert, by inspection of the type/return contract rather than a live note, that `createSummarizeHook`'s resolved value is always exactly `undefined` or exactly `{ summary: string, futureDirections: string }` — no other field, no note-body/free-form-content field exists on the shape at all — so 003's `renderProse()` (research.md §2, the only place this text is placed) has no path by which this feature's output could reach anything but its own managed fields. Confirm this holds for both the success and every failure case above (a failure is always `undefined`, never a partial object).

### Future-directions gating (US2)

- **Cited paper → no future-directions call** (FR-004, research.md §2): `input.citationsKnown === true, citationCount > 0` → `isUncited(input)` is `false`; the fake provider's `generate` is asserted to receive no signal requesting future-directions (or a second fake tracking a separate call count stays at 0); `futureDirections` in the result is `''`.
- **Uncited paper, summary succeeds, future-directions succeeds** (FR-003/SC-002): `citationsKnown: true, citationCount: 0`, fake resolves both fields → hook resolves `{ summary, futureDirections: '<40+ chars>' }`.
- **Uncited paper, future-directions too-short/fails but summary succeeds → degrade, don't discard** (research.md §2): fake resolves a valid `summary` but an empty/too-short `futureDirections` → hook resolves `{ summary, futureDirections: '' }`, not `undefined` — a future-directions-only shortfall never discards a good summary.
- **Unknown citation status is not uncited** (data-model.md §4, spec Edge Cases): `citationsKnown: false, citationCount: 0` → `isUncited(input)` is `false` (un-enriched zero is "unknown", not "uncited").

### Provider & credentials (US3)

- **Provider swap requires no `hook.ts` change** (FR-006, Principle VI): asserting the scratch script instantiates the same `createSummarizeHook` against two different fake `SummarizationProvider` objects (different `id`s) with identical hook behavior demonstrates the abstraction is swappable.
- **Credential omitted → treated as not configured** (FR-006/FR-008): `getProvider` returns a provider but `getCredential` returns `undefined`/empty string → hook resolves `undefined`, `generate` never called.
- **Summarization and embedding toggles are independent** (FR-011): drive `createSummarizeHook` with only `summarizationProvider`/`summarizationCredential`-equivalent fakes configured (no embedding credential anywhere in scope) and confirm it still resolves a summary; separately, call `llmEmbeddingUpgrade` with only an embedding credential (no summarization provider/credential configured at all) and confirm it still resolves a valid `EmbeddingResult` — enabling one never requires the other to be configured.

### LLM embedding upgrade (the `EmbeddingConfig`/`embeddingUpgrade.ts` seam)

- **Credential missing → undefined, no call** (research.md §8): `llmEmbeddingUpgrade(title, abstract, undefined)` resolves `undefined` without invoking the fake `embed`.
- **Success → correct naming contract** (data-model.md §5): fake `embed` resolves `{ vector: [0.1, 0.2, ...], model: 'text-embedding-3-small' }` → result's `embeddingModel` is exactly `llm:text-embedding-3-small:d<vector length>` and `embeddingSource` is `'llm'`.
- **Invalid vector → undefined** (data-model.md §2): fake `embed` resolves `{ vector: [], model: '...' }` (empty) and separately `{ vector: [1, NaN], model: '...' }` (non-finite) → both resolve `undefined`.
- **Timeout/provider-error/invalid-credentials → undefined** (mirrors the text-generation cases above): each resolves `undefined`, never throws.
- **`isCanonical()` recognizes the result** (research.md §8, binding downstream contract): feed a successful result's `embeddingModel` string into `src/collection/reembed.ts`'s `isCanonical()` (`case 'llm': return model.startsWith('llm:')`) directly in the scratch script → asserts `true`.

## Expected outcome

All `PASS` lines, zero `FAIL`. Delete `scratch/` afterward.

## Manual in-vault smoke (adapter only)

Because `providers/openai.ts` is the sole network-touching code (via `requestUrl`), verify it once by hand: enable summarization in settings with a real OpenAI key, collect a single paper, and confirm (a) the resulting note's managed region shows a generated summary instead of the raw abstract, (b) an uncited paper's note additionally shows a future-directions section, (c) disabling the feature (or removing the key) and collecting another paper falls back to the abstract with no error surfaced to the user, and (d) if the LLM embedding provider is also selected, the paper's persisted record has an `embeddingModel` starting with `llm:`.

## Triggering a real collection before the 008 UI exists (team smoke with your own key)

The subscription-management UI that starts a collection is owned by 008 and not built yet; the scheduler ships with `autoStart: false`, so **loading the plugin never collects on its own** (`src/collection/scheduler.ts` — "only an explicit `checkNow`/`backfillNow` drives collection"). Until 008 lands, drive one real end-to-end collection — real arXiv + Semantic Scholar + your chosen summarization provider — straight through the shipped plugin from Obsidian's developer console. This needs no test harness and no repo changes; it runs the exact `main.ts` wiring a user eventually will.

Each teammate uses their **own** API key (bring-your-own-key; `data.json` is git-ignored and holds a plaintext key, so it is never committed).

1. **Build & install the plugin.** `npm run build`, then copy `main.js` + `manifest.json` (+ `styles.css` if present) into `<Vault>/.obsidian/plugins/paper-graph-3d/`.
2. **Configure `data.json`** at `<Vault>/.obsidian/plugins/paper-graph-3d/data.json`:
   ```json
   {
     "subscriptions": [
       { "type": "keyword", "value": "mixture of depths",
         "checkIntervalHours": 24, "enabled": true,
         "lastCheckedAt": 1780272000000 }
     ],
     "settings": {
       "storageLocation": "PaperGraph3D",
       "summarizationEnabled": true,
       "summarizationProvider": "anthropic",
       "summarizationCredential": "<your-api-key>",
       "graphDisplayOptions": { "layout": "force-directed", "colorScheme": "byPublicationYear" }
     }
   }
   ```
   - `summarizationProvider` is one of `openai` / `anthropic` / `gemini`; `summarizationCredential` is the matching key.
   - A past `lastCheckedAt` (e.g. `1780272000000` = 2026-06-01) makes the collection window cover a span that contains Semantic-Scholar-indexed, zero-citation papers, so you can see the **future-directions** section (only generated when `citationsKnown === true && citationCount === 0`).
3. **Reload the plugin** (Settings → Community plugins → toggle it Off then On) so it re-reads `data.json`.
4. **Open the developer console** (macOS `Cmd+Opt+I`, Windows/Linux `Ctrl+Shift+I` → Console tab) and run:
   ```js
   const p = app.plugins.plugins['paper-graph-3d'];
   const sub = (await p.loadData()).subscriptions[0];
   await p.scheduler.checkNow(sub);
   console.log('collection done');
   ```
5. **Confirm** the notes under `<Vault>/PaperGraph3D/<year>/<month>/<day>/`: each managed region (between the `<!-- pg3d:begin -->` / `<!-- pg3d:end -->` markers) holds a generated summary; uncited papers additionally carry a `## Future directions` section; a paper whose citation status is still unknown (a brand-new arXiv id not yet in Semantic Scholar → `citationsKnown: false`) correctly gets the summary only.

Notes:
- A successful `checkNow` advances the subscription's `lastCheckedAt` to now; to re-run the same window, reset `lastCheckedAt` to a past value in `data.json` and reload again.
- `p.scheduler` is `undefined` if the plugin is not enabled / still loading.
- A summary that shows the raw abstract instead of generated text means the provider call fell back (bad/expired key, no billing credits, or a transient provider error) — fallback never blocks persistence (FR-007), so the note is still written.
