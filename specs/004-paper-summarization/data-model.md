# Phase 1 Data Model: Paper Summarization & Future-Directions Text

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

This feature persists nothing itself (spec Out of Scope). This document covers (a) the two fixed external types 004 must conform to, unchanged by 004, and (b) the new types/fields 004 actually owns.

## 1. Fixed external contract (002-owned, imported — not redefined)

Source: `src/collection/types.ts` (re-exported by `src/collection/pipeline.ts`).

| Type | Fields | Notes |
|---|---|---|
| `SummarizationInput` | `title: string`, `abstract: string`, `citationCount: number`, `citationsKnown: boolean` | What 002 hands to `summarize`. Deliberately not the full `Paper` (002's own data-minimization choice). |
| `SummaryResult` | `summary: string`, `futureDirections: string` | What `summarize` must resolve to (or `undefined`). `futureDirections: ''` is the already-implemented (003) "not applicable" sentinel. |
| `PipelineHooks['summarize']` | `(input: SummarizationInput) => Promise<SummaryResult \| undefined>` | The exact function signature `hook.ts` must satisfy. |
| `EmbeddingConfig` (`src/collection/embeddingUpgrade.ts`) | `provider: EmbeddingProvider`, `localModel?: string`, **`credential?: string` (004 adds this field)** | Read live per paper by 002's `upgradeEmbedding()`/`reembedCorpus()`. |
| `EmbeddingResult` (`src/collection/embedding.ts`) | `embedding: number[]`, `embeddingModel: string`, `embeddingSource: EmbeddingSource` | The return shape `upgradeEmbedding()`/`reembedCorpus()` expect from any provider branch, including 004's. |

## 2. New types owned by 004 (`src/services/summarization/types.ts`)

```ts
// Text-generation provider abstraction (research.md §4). NOT the same as
// models/settings.ts's EmbeddingProvider (that is the 3-way category selector
// 002 owns) — this is a pluggable vendor implementation.
export interface SummarizationProvider {
	id: string;
	generate(
		input: SummarizationInput, // imported from ../../collection/pipeline
		credential: string,
		signal: AbortSignal,
	): Promise<{ summary: string; futureDirections?: string }>;
}

export type GenerationFailureReason =
	| 'timeout'
	| 'invalid-credentials'
	| 'empty-or-too-short'
	| 'provider-error';

export type GenerationOutcome =
	| { ok: true; summary: string; futureDirections: string }
	| { ok: false; reason: GenerationFailureReason };

// LLM embedding provider abstraction. Deliberately named LlmEmbeddingProvider,
// NOT EmbeddingProvider — that name is already taken by models/settings.ts's
// 3-way category selector type ('bundled' | 'local-transformer' | 'llm').
export interface LlmEmbeddingProvider {
	id: string;
	embed(
		title: string,
		abstract: string,
		credential: string,
		signal: AbortSignal,
	): Promise<{ vector: number[]; model: string }>;
}

export type EmbeddingFailureReason =
	| 'timeout'
	| 'invalid-credentials'
	| 'invalid-vector'
	| 'provider-error';

export type EmbeddingOutcome =
	| { ok: true; vector: number[]; model: string }
	| { ok: false; reason: EmbeddingFailureReason };
```

**Validation rules**:
- `GenerationOutcome`/`EmbeddingOutcome` are internal to `generate.ts` — never exposed past `hook.ts`/`embeddingHook.ts`, which collapse every `ok: false` case to `undefined` (matching `PipelineHooks['summarize']`'s and `upgradeEmbedding()`'s "never throw, return undefined on failure" contracts).
- A generated `summary` is `ok: false, reason: 'empty-or-too-short'` when `summary.trim().length < 20` (research.md §5). The same threshold applies independently to `futureDirections` (research.md §2 — a future-directions-specific shortfall degrades `futureDirections` to `''`, not the whole outcome to failure).
- `EmbeddingOutcome`'s `vector` must be a non-empty array of finite numbers (`Number.isFinite`); anything else is `invalid-vector`.

## 3. `PluginSettings` extension (`src/models/settings.ts`, 004-owned additive fields)

```ts
export interface PluginSettings {
	// ...existing 001/002 fields unchanged...

	// 004-owned (FR-006). Which SummarizationProvider.id to use for text
	// generation. Absent/undefined -> no summarization call is possible even if
	// summarizationEnabled is true (treated as "not configured", FR-008-style
	// credential-problem messaging).
	summarizationProvider?: string;
	// 004-owned (FR-006). Plaintext credential for the summarization provider
	// (constitution Principle IV, FR-013 — disclosed in settings UI copy, research.md §12).
	summarizationCredential?: string;
	// 004-owned (FR-010, spec Key Entities: "this feature owns only the LLM
	// option's key"). Plaintext credential for the LLM embedding upgrade, read by
	// main.ts's existing getEmbeddingConfig() getter and threaded into
	// EmbeddingConfig.credential (research.md §8). Independent of
	// summarizationCredential (FR-011: sharing is allowed, not required — a user
	// may enter the same value in both).
	embeddingCredential?: string;
}
```

`DEFAULT_PLUGIN_SETTINGS` is unchanged (all three fields optional, absent by default — FR-001/FR-002, matching 002's own `semanticScholarApiKey`/`embeddingProvider` precedent). `isValidPluginSettings()` gains three `undefined`-or-`string` checks, same pattern as the existing `semanticScholarApiKey` check.

## 4. `isUncited()` input shape (`src/services/summarization/isUncited.ts`)

```ts
export interface UncitedCheckInput {
	citationsKnown: boolean;
	citationCount: number;
}
export function isUncited(input: UncitedCheckInput): boolean;
```

Structurally satisfied by both `SummarizationInput` (004's own call site, `hook.ts`) and the full `Paper` (a future 007 call site) with no cast (research.md §9). Returns `true` only when `citationsKnown && citationCount === 0` — an un-enriched `citationCount === 0` (`citationsKnown === false`) is NOT uncited, it is unknown (spec Edge Cases / 002 FR-018/FR-016).

## 5. `embeddingModel` naming contract for the LLM path

`llmEmbeddingUpgrade()` (in `embeddingHook.ts`) must format the returned `EmbeddingResult.embeddingModel` as:

```text
llm:<provider-model-id>:d<vector-dimension>
```

e.g. `llm:text-embedding-3-small:d1536`. This exact prefix (`llm:`) is required by 002's already-merged `src/collection/reembed.ts`'s `isCanonical()` (`case 'llm': return model.startsWith('llm:');`) — not a 004 design choice, a binding downstream contract (research.md §8).

## 6. State transitions

None owned by 004. `Paper.embedding`/`embeddingModel`/`embeddingSource` transitions (baseline → LLM-canonical, canonical → pending-upgrade on provider switch) are entirely 002's `upgradeEmbedding()`/`reembedCorpus()` responsibility, already implemented. `PaperRecord.summary`/`futureDirections` transitions (create vs. field-scoped-merge-preserve on update) are entirely 003's `wrap()`/`mergePaper()` responsibility, already implemented. 004 only produces a `SummaryResult`/`EmbeddingResult` value once, per paper, at the moment 002 calls it (research.md §6 — no self-triggered recomputation).
