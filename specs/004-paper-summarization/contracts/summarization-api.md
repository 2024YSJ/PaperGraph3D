# Contract: `src/services/summarization/` exported API + the two 002-file edits

> **[Amended 2026-07-16 — the LLM embedding half of this feature is withdrawn]**
>
> Everything below about **embeddings** — `LlmEmbeddingProvider`, `embeddingHook.ts`,
> `runEmbeddingGeneration`, `openAiEmbeddingProvider`, `llmEmbeddingModelId`, the
> `llm:<model>:d<dim>` naming contract, `EmbeddingConfig.credential`, the
> `embeddingCredential` setting, and the independent embedding toggle — **no longer
> applies**. That code is deleted and FR-010/FR-011/FR-012 are withdrawn.
>
> Why: embedding dimensionality varied by provider and model, but only vectors sharing
> one space can be projected together (001 FR-020) — a selectable provider was a
> selectable dimensionality. The canonical space is now one fixed on-device model
> (SPECTER2), owned by 002. See constitution v1.3.0 and 002 FR-045/FR-046.
>
> **Summarization is unaffected** and everything below about generating summary text
> — the provider abstraction, the three providers, the timeout/fallback rules, the
> disclosure copy — is still current.

This is the internal contract `src/main.ts` and (for the embedding half) `src/collection/embeddingUpgrade.ts`/`reembed.ts` build against. Library-style — TypeScript types/function signatures — not a network/CLI interface. This feature makes external network calls only when explicitly enabled (constitution Principle IV); every exported function either resolves to a plain value/typed-undefined or never throws (callers never need a try/catch to stay safe, matching 002's own hook-calling code in `pipeline.ts`, which still wraps the call defensively).

## `src/services/summarization/hook.ts`

```ts
import type { SummarizationInput, SummaryResult } from '../../collection/pipeline';
import type { SummarizationProvider } from './types';

export interface SummarizeHookConfig {
	getProvider: () => SummarizationProvider | undefined; // undefined = not configured
	getCredential: () => string | undefined;
	notifyCredentialProblem: (message: string) => void; // FR-008
}

export function createSummarizeHook(
	config: SummarizeHookConfig,
): (input: SummarizationInput) => Promise<SummaryResult | undefined>;
```

**Behavior guarantees**:
- Returns `undefined` (never throws) when: no provider configured, no credential configured, generation times out, generation returns invalid credentials (after calling `notifyCredentialProblem`, FR-008), or the summary is empty/too-short (data-model.md §2). This is the exact shape `PipelineHooks['summarize']` requires (data-model.md §1) — `main.ts` wires `pipelineHooks.summarize = createSummarizeHook({...})` with no adapter of its own.
- When the summary succeeds but the paper is not uncited (`isUncited(input)` is `false`), `futureDirections` is `''` (the already-implemented 003 "not applicable" sentinel, research.md §2) — no future-directions call is even attempted.
- When the summary succeeds and the paper is uncited, a future-directions generation is attempted; its own failure/too-short outcome degrades `futureDirections` to `''` without discarding the summary (research.md §2) — only a *summary* failure triggers the full `undefined` (abstract-fallback) return.
- Never inspects or requires anything beyond `SummarizationInput`'s four fields — no upstream caller needs to construct a full `Paper`.

## `src/services/summarization/embeddingHook.ts`

```ts
import type { EmbeddingResult } from '../../collection/embedding';
import type { LlmEmbeddingProvider } from './types';

export interface EmbeddingHookConfig {
	getProvider: () => LlmEmbeddingProvider; // fixed to the OpenAI reference provider for now (research.md §4)
}

export async function llmEmbeddingUpgrade(
	title: string,
	abstract: string,
	credential: string | undefined,
	config?: EmbeddingHookConfig,
): Promise<EmbeddingResult | undefined>;
```

**Behavior guarantees**:
- Returns `undefined` (never throws) when: `credential` is `undefined`/empty, the call times out, credentials are rejected, or the returned vector is invalid (non-array, empty, or contains a non-finite number) — matching `upgradeEmbedding()`'s existing `local-transformer` branch's "any failure -> undefined, caller keeps the baseline" contract exactly (data-model.md §1, research.md §8).
- On success, `embeddingModel` is formatted `llm:<model-id>:d<dim>` (data-model.md §5) and `embeddingSource` is `'llm'` — this exact shape is what `src/collection/embeddingUpgrade.ts`'s `case 'llm':` branch returns directly to its own caller (`upgradeEmbedding()`'s return type), and what `reembed.ts`'s `isCanonical()` inspects.

## `src/services/summarization/generate.ts` (internal, used by `hook.ts`/`embeddingHook.ts` only — not exported past them)

```ts
export async function runGeneration(
	input: SummarizationInput,
	provider: SummarizationProvider,
	credential: string,
	wantFutureDirections: boolean,
): Promise<GenerationOutcome>; // data-model.md §2

export async function runEmbeddingGeneration(
	title: string,
	abstract: string,
	provider: LlmEmbeddingProvider,
	credential: string,
): Promise<EmbeddingOutcome>; // data-model.md §2
```

**Behavior guarantees**:
- Both apply the 20s timeout (research.md §11) via an `AbortSignal` passed to the provider's `generate`/`embed` call; a rejection after abort is classified `'timeout'`, never left to bubble as an unhandled rejection.
- Neither function ever throws — every provider-call rejection (network error, non-2xx response, malformed JSON) is caught and classified into a `GenerationFailureReason`/`EmbeddingFailureReason`.
- `runGeneration` applies the too-short/empty threshold (research.md §5) to `summary` unconditionally; it applies the same threshold to `futureDirections` only when `wantFutureDirections` is `true` — the caller (`hook.ts`) computes this via `isUncited(input)` and passes it in explicitly, so `generate.ts` itself never imports or re-derives `isUncited` (research.md §9). The provider's `generate()` is still always asked for both fields in one call (providers/openai.ts is agnostic to gating); `wantFutureDirections` only controls whether a too-short `futureDirections` degrades to `''` versus is simply ignored.

## `src/services/summarization/isUncited.ts`

```ts
export interface UncitedCheckInput {
	citationsKnown: boolean;
	citationCount: number;
}
export function isUncited(input: UncitedCheckInput): boolean;
```

Reusable as-is by 007 against a full `Paper` (data-model.md §4) — no wrapper needed.

## `src/services/summarization/providers/openai.ts`

```ts
export const openAiProvider: SummarizationProvider; // id: 'openai'
export const openAiEmbeddingProvider: LlmEmbeddingProvider; // id: 'openai'
```

**Behavior guarantees**:
- Both call `requestUrl` (obsidian package), never `fetch` (matches every 002 provider client, constitution Principle I mobile-parity rationale — though this feature is desktop-only, consistency avoids a second HTTP pattern in the codebase).
- `openAiProvider.generate` sends only `{ title, abstract }` (never `citationCount`/`citationsKnown`, which are 004's own gating logic, not provider input) via Chat Completions; a non-2xx response with a 401/403 status is classified `invalid-credentials` by the caller (`generate.ts`), any other non-2xx is `provider-error`.
- `openAiEmbeddingProvider.embed` sends only `{ title, abstract }` via the Embeddings endpoint (`text-embedding-3-small`, research.md §4); `model` in its resolved value is the raw OpenAI model id (`text-embedding-3-small`) — `embeddingHook.ts`, not this provider, applies the `llm:<model>:d<dim>` formatting (keeping the provider ignorant of 002's naming contract, so a second provider module does not need to know it either).

## Edits to already-merged 002 files (the seam, research.md §8)

### `src/collection/embeddingUpgrade.ts`

```diff
 export interface EmbeddingConfig {
 	provider: EmbeddingProvider;
 	localModel?: string;
+	credential?: string;
 }
```

```diff
-			case 'llm':
-				// The LLM embedding upgrade is a 004-owned hook (002 FR-045), not yet
-				// implemented — a no-op stub until 004 ships. Baseline is kept (pending).
-				return undefined;
+			case 'llm': {
+				const credential = config.credential?.trim();
+				if (credential === undefined || credential.length === 0) {
+					return undefined;
+				}
+				return await llmEmbeddingUpgrade(title, abstract, credential);
+			}
```

(plus `import { llmEmbeddingUpgrade } from '../services/summarization/embeddingHook';` at the top.) No other line in this file changes — the `'local-transformer'`/`'bundled'` branches, the function's `try/catch`/`Promise<EmbeddingResult | undefined>` signature, and every comment not shown above are untouched.

### `src/collection/reembed.ts`

```diff
-	// The LLM upgrade is a 004-owned hook not yet implemented; there is no canonical
-	// LLM space to converge to, so re-embedding is a no-op that must not destroy
-	// existing vectors. (Removed once the LLM provider ships.)
-	if (config.provider === 'llm') {
-		return summary;
-	}
-
 	for await (const paper of store.all()) {
```

No other line in this file changes — `isCanonical()`'s existing `case 'llm': return model.startsWith('llm:');` already works correctly once real `llm:`-prefixed vectors exist (data-model.md §5); it required no edit.

### `src/main.ts`

```diff
 		const pipelineHooks: PipelineHooks = {
+			summarize: createSummarizeHook({
+				getProvider: () => (this.settings.summarizationProvider === 'openai' ? openAiProvider : undefined),
+				getCredential: () => this.settings.summarizationCredential,
+				notifyCredentialProblem: (message) => new Notice(message),
+			}),
 			persist: (paper, summary) =>
 				paperStore.upsert({ ... }),
 			alreadyPersisted: async (sourceId) => paperStore.has(sourceId),
 		};
```

```diff
 		void reembedCorpus(paperStore, {
 			provider: this.settings.embeddingProvider ?? 'bundled',
 			localModel: this.settings.localEmbeddingModel,
+			credential: this.settings.embeddingCredential,
 		}).catch(() => undefined);
```

```diff
 				() => ({
 					provider: this.settings.embeddingProvider ?? 'bundled',
 					localModel: this.settings.localEmbeddingModel,
+					credential: this.settings.embeddingCredential,
 				}),
```

No other line in `main.ts` changes; `pipelineHooks.summarize` was previously omitted with a comment ("stays omitted (undefined) until 004 (summarization) ships") that this edit resolves.
