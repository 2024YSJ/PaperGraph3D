# Phase 0 Research: Paper Summarization & Future-Directions Text

This research is written against the **real, already-merged** 002 (`src/collection/`) and 003 (`src/persistence/`) implementations on `develop` @ `899abca`, not a hypothetical interface. Where a decision is actually already settled by merged code (not a 004 choice at all), that is stated explicitly rather than re-litigated.

## 1. The `PipelineHooks` adapter contract (load-bearing, not a choice)

**Finding**: `src/collection/types.ts` (002, merged) already fixes the exact shape 004 must produce:

```ts
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
	alreadyPersisted: (sourceId: PaperSourceId) => Promise<boolean>;
}
```

004 does not define these types — it imports them (from `../../collection/pipeline`, which re-exports `types.ts`) so there is zero drift between what 002 calls and what 004 returns. `SummarizationInput` is deliberately narrower than `Paper` (title/abstract/citationCount/citationsKnown only) — this is 002's own data-minimization choice, not something 004 needs to re-decide.

**Decision**: `hook.ts` exports `summarizeHook(input: SummarizationInput): Promise<SummaryResult | undefined>`, built by partially applying live settings getters (provider id, credential, enabled-check) so `main.ts` can wire it as `pipelineHooks.summarize = summarizeHook` (or a small closure) with no further adaptation.

## 2. `futureDirections` "not applicable" sentinel and abstract fallback (already implemented downstream)

**Finding**: `src/persistence/note.ts`'s `renderProse()` (003, merged):

```ts
function renderProse(record: PaperRecord): string {
	const base = record.summary ?? record.paper.abstract;
	if (record.futureDirections) {
		return `${base}\n\n## Future directions\n\n${record.futureDirections}`;
	}
	return base;
}
```

`record.summary === undefined` already falls back to `paper.abstract` — 004 does not need its own fallback-to-abstract code path; it only needs to return `undefined` from `summarizeHook` on total failure (FR-007). An **empty string** for `futureDirections` is already a valid, truthy-check-skipped sentinel for "not applicable" (already-cited paper). `SummaryResult.futureDirections` is non-optional in the type, so 004 always returns a string — `''` when the paper is cited, the generated text when uncited.

**Decision**: `SummaryResult.futureDirections` is `''` unless `isUncited(input)` is true AND generation of the future-directions text itself succeeds; a future-directions-specific failure degrades to `''` (summary-only), never to discarding the whole `SummaryResult` (FR-004's "only a summary" outcome for a generation hiccup on the future-directions half is a safe degrade, not a total-fallback trigger — only a *summary* failure triggers the abstract fallback via `undefined`).

## 3. OQ-1 — Definition of "most recent" uncited papers (shared with 007)

**Decision**: No separate time-window gate. Re-reading spec.md's own Edge Cases and FR-004 (not just the US2 title), the sole criterion is `citationCount === 0`: *"Whether a paper is 'uncited' is read from its canonical record's citation count (0 = uncited)."* No FR mentions a recency cutoff. "Recent" in the US2 title is descriptive framing, not a distinct requirement — arXiv-sourced papers (002's only discovery provider) are inherently recent by construction, so an uncited arXiv paper is already "recent" without an additional filter.

**Rationale**: Introducing an undefined time window (calendar cutoff? rolling N days? top-N by date?) would require a second, unspecified parameter with no default the spec supplies, and would silently exclude an uncited-but-slightly-older paper from future-directions text for no requirement-backed reason. Keeping the single `citationCount === 0` gate is simpler, matches FR-004's literal text, and needs no new setting.

**Alternatives considered**: A rolling window (e.g. "published within 2 years") was considered but rejected — no FR specifies a cutoff value, and 007 (uncited-node styling, per its own spec references) reads the same `citationsKnown`/`citationCount` signal without a window either, so there is no cross-feature need to invent one here.

## 4. OQ-2 / OQ-5 — Provider contract shape (summarization text + LLM embedding)

**Decision**: A generic provider abstraction, reference-implemented against **OpenAI** (Chat Completions for text, Embeddings for vectors), called via Obsidian's `requestUrl` (never `fetch`, matching every 002 provider client) with a bounded `AbortSignal` timeout.

```ts
export interface SummarizationProvider {
	id: string;
	generate(input: SummarizationInput, credential: string, signal: AbortSignal): Promise<{ summary: string; futureDirections?: string }>;
}
export interface LlmEmbeddingProvider {
	id: string;
	embed(title: string, abstract: string, credential: string, signal: AbortSignal): Promise<{ vector: number[]; model: string }>;
}
```

**Rationale**: The spec (FR-006/Key Entities) requires the user to choose "which provider" and supply credentials, but does not mandate a specific vendor. An interface keyed by `id` (mirroring 002's `EMBEDDING_PROVIDERS`-array-derived-union pattern used for the *provider category* selector) lets `providers/openai.ts` be the only concrete implementation shipped now while `generate.ts`/`embeddingHook.ts` depend only on the interface — adding Claude/Gemini later is a new file under `providers/`, not a rewrite (constitution Principle VI).

**Alternatives considered**: Hard-coding OpenAI's request/response shape directly into `generate.ts` was rejected — it would coincidentally work for the MVP but violates the "extend, don't rewrite" rule the moment a second provider is added, and the interface costs nothing extra now.

## 5. OQ-3 — "Too short / empty" threshold (FR-007)

**Decision**: A generated summary is treated as too-short (triggering the abstract fallback) when its trimmed length is under **20 characters**. Future-directions text uses the same threshold, independently, per §2's degrade-not-discard rule.

**Rationale**: 20 characters is well below any coherent sentence (a real summary is realistically 1+ sentences, 50+ chars) but comfortably above degenerate provider output ("N/A", "None.", empty string, whitespace-only) — the known failure modes this guards against (FR-007's "empty or too short"). A word-count threshold was considered but character length is simpler to compute and just as effective for catching degenerate output; the exact number is intentionally generous (a false-positive fallback is harmless — the abstract is always a safe substitute) rather than tuned to reject legitimately terse-but-real summaries.

**Alternatives considered**: A stricter word-count minimum (e.g. 5 words) was considered but rejected as needing locale/tokenization handling for no real benefit over a simple character-length check.

## 6. OQ-4 — Recomputation on citation-count transition (uncited → cited)

**Decision**: No automatic regeneration. Text generated once, at initial persist time (the only time 004 is invoked — see spec Assumptions: "This feature does not self-trigger"), is kept as-is. If a paper later transitions uncited → cited via refresh (005), its existing future-directions text is left in place (a completed persist call is not re-run).

**Rationale**: 004 has no re-trigger mechanism and the spec's Assumptions section is explicit that 002 is the only caller, invoked once per paper before its *first* persist. Building a citation-transition watcher would require 004 to either poll the store or subscribe to 005's refresh outcome — both out of this feature's scope (spec's Out of Scope section: "Refreshing citation data (005) is separate; this feature only reads citation status to decide on future-directions text"). This is deferred to 005's own design, consistent with how 005's spec already lists it as a shared Open Question.

**Alternatives considered**: Regenerating on every persist call regardless of whether the paper already has a record was rejected — 002's pipeline invokes `hooks.summarize` unconditionally when `isSummarizationEnabled()` is true (see `pipeline.ts`), with no "is this an update" branch; teaching 004 to detect "already has a summary, skip" would require passing the previous record into the hook, which is not part of the fixed `SummarizationInput` contract (§1) and is out of scope to redesign.

## 7. OQ-6 — Retain both embeddings, or overwrite? (settled by merged code, not a 004 decision)

**Finding**: Already answered by the real `Paper` schema (`src/models/paper.ts`, unchanged since 001) and 002's actual upgrade logic (`src/collection/pipeline.ts` lines 95-111): `Paper` has exactly **one** embedding slot (`embedding: number[] | null`, `embeddingModel: string | null`, `embeddingSource: EmbeddingSource | null`). A successful upgrade **overwrites** that slot; the bundled baseline is never stored twice — it is simply recomputed on demand (it is deterministic and cheap, `src/collection/embedding.ts`'s `computeBaselineEmbedding`), which is why a paper "falls back" to it by leaving the slot alone rather than reading a second stored vector.

**Implication for 004**: `llmEmbeddingUpgrade()` returns a single `{ vector, model }` (or a typed failure) — there is no "retain both" branch to design; 002's `upgradeEmbedding()` dispatcher (§8) already handles the overwrite-on-success / keep-baseline-on-failure logic uniformly across all three providers.

## 8. The embedding-upgrade seam (load-bearing, not a choice)

**Finding**: 002's three-provider embedding dispatcher is already implemented and merged, with an explicit, named stub for 004:

- `src/models/settings.ts` already defines `EMBEDDING_PROVIDERS = ['bundled', 'local-transformer', 'llm']` / `EmbeddingProvider` (the 3-way **selector** type — 004 must NOT reuse this name for its own provider-abstraction interface; see §4's `LlmEmbeddingProvider` naming).
- `src/collection/embeddingUpgrade.ts` exports `EmbeddingConfig { provider: EmbeddingProvider; localModel?: string }` and `upgradeEmbedding(title, abstract, config): Promise<EmbeddingResult | undefined>`, whose `case 'llm':` branch currently `return undefined;` with the comment *"The LLM embedding upgrade is a 004-owned hook (002 FR-045), not yet implemented — a no-op stub until 004 ships."*
- `src/collection/reembed.ts`'s `reembedCorpus()` has a matching guard, `if (config.provider === 'llm') { return summary; }`, commented *"(Removed once the LLM provider ships.)"*.
- `src/collection/reembed.ts`'s `isCanonical()` checks an LLM-space paper via `model.startsWith('llm:')` — this is a **binding naming contract**, not a suggestion: whatever `embeddingModel` string 004 produces MUST start with `llm:` or re-embed convergence silently never recognizes an already-upgraded paper as canonical (it would be perpetually treated as pending and re-upgraded every `reembedCorpus` pass — wasteful, not correctness-breaking, since `computeCanonical`/`upgradeEmbedding` are idempotent, but wrong).
- `EmbeddingConfig` currently carries no credential field — 004 must add one.

**Decision**:
1. Add `credential?: string` to `EmbeddingConfig` in `embeddingUpgrade.ts` (one-line additive edit to an already-merged 002 file — the interface is exported and this is exactly the kind of extension its own stub comment anticipates).
2. Replace the `case 'llm':` body to call `llmEmbeddingUpgrade(title, abstract, config.credential)` (defined by 004 in `src/services/summarization/embeddingHook.ts`), returning `undefined` when no credential is configured (mirroring the existing `local-transformer` branch's empty-model-spec guard).
3. Remove `reembed.ts`'s `if (config.provider === 'llm') return summary;` guard now that the branch is real.
4. `llmEmbeddingUpgrade()`'s `embeddingModel` is formatted `llm:<model-id>:d<dim>` (mirrors `local-transformer.ts`'s own `local-transformer:<spec>:d<dim>` pattern exactly), satisfying `isCanonical()`'s prefix check.
5. `main.ts`'s existing `getEmbeddingConfig` getter (`() => ({ provider: this.settings.embeddingProvider ?? 'bundled', localModel: this.settings.localEmbeddingModel })`) gains one field: `credential: this.settings.embeddingCredential`.

**Rationale**: This is the narrowest possible change that completes an already-designed, already-tested stub — 002's dispatcher, `EmbeddingConfig` shape, and `reembedCorpus` orchestration are not redesigned, only extended exactly where their own comments say 004 should extend them.

## 9. `isUncited()` minimal structural shape

**Decision**: `isUncited(input: { citationsKnown: boolean; citationCount: number }): boolean { return input.citationsKnown && input.citationCount === 0; }`, defined once in `src/services/summarization/isUncited.ts` against a minimal structural type — not the full `Paper`.

**Rationale**: 004's own `hook.ts` calls it with a `SummarizationInput` (which has exactly these two fields plus `title`/`abstract` — structurally compatible with no cast). 007 (uncited-node styling, per spec cross-reference) can call the same function with a full `Paper` object (which also structurally satisfies `{ citationsKnown, citationCount }`) without 007 needing to import anything from `src/collection/` or construct a fake `SummarizationInput`. A structural (not nominal) minimal type keeps this one function reusable by both call sites with zero adaptation.

**Alternatives considered**: Accepting a full `Paper` was rejected — it would force `SummarizationInput` (which is not a `Paper`) to be upcast/duck-typed awkwardly at 004's own call site, the opposite of the minimization 002 already designed `SummarizationInput` for (§1).

## 10. Credential storage and sharing between summarization and embedding

**Decision**: Two independent optional settings fields — `summarizationProvider?: string`, `summarizationCredential?: string` (both 004-owned, extending `PluginSettings`) — plus a third, `embeddingCredential?: string` (also 004-owned; the embedding-provider *category* selector `embeddingProvider`/`localEmbeddingModel` remains 002-owned per §8). A user MAY enter the same key in both fields (sharing a provider/account) or configure them independently (spec FR-011: "Provider/credential selection MAY be shared across both" — permissive, not mandatory sharing). No UI-level "reuse this key" convenience is built; that is a 008 (settings screen) presentation concern, not a 004 data-model concern.

**Rationale**: Matches the spec's Key Entities section verbatim ("This feature owns only the LLM option's key") and 008's already-updated spec language ("the LLM embedding API key (a 004 extension field, 004 FR-010)"). Keeping the two credentials as separate fields (rather than one shared field) avoids forcing a user who wants summaries from one vendor and embeddings from another (e.g. cost or rate-limit reasons) into a single shared key.

## 11. Timeout duration

**Decision**: 20 seconds, via `AbortSignal.timeout(20_000)` (or an equivalent manual timer + `AbortController`, matching whatever pattern 002's provider clients already use for consistency — confirmed against `arxivClient.ts`/`semanticScholarClient.ts` at implementation time), applied identically to both the summary/future-directions call and the embedding call.

**Rationale**: Long enough for a typical chat-completion response (a few seconds to ~15s under normal load) without leaving a collection batch stalled for minutes on a hung connection (FR-007/FR-012's "MUST NOT block" requirement, and `pipeline.ts`'s sequential per-paper loop — one slow call delays every subsequent paper in the batch).

## 12. Settings-UI disclosure copy (constitution Principle IV — the old spec's removed FR)

**Finding**: The previous spec draft had an explicit numbered FR requiring pre-enable disclosure copy; the current canonical spec (`specs-input/004-paper-summarization/spec.md`) does not carry that FR forward as a distinct number. Constitution Principle IV (unchanged, v1.2.0) still binds regardless: *"Before shipping any network request... the change MUST explain — in the PR/commit description, in `README.md`, and in the relevant settings UI — what is being called, why, what data (if any) leaves the device, and how the user opts in."*

**Decision**: Disclosure is still designed in, as an explicit deliverable in tasks.md (settings-UI copy: what is sent — title+abstract only, never the full record — to which configured provider, that credentials are stored in plaintext in the plugin's data file, and that both toggles default to off), even without a dedicated FR number, because the constitution's Principle IV is binding independent of whether the spec restates it (plan.md's Constitution Check gate, not spec.md, is what enforces this). This mirrors 002's own plan.md, which carries an identical "Pass, with a documentation obligation carried into tasks.md" note for its own network calls.

**Rationale**: A constitution principle is non-negotiable per this project's own `/speckit-analyze` rules ("Constitution conflicts are automatically CRITICAL... the spec, plan, or tasks" must adjust, not the principle) — the absence of a spec-level FR number is not license to skip it; plan.md is exactly where a constitution-driven-but-not-spec-numbered obligation gets tracked forward into tasks.

## 13. Out of scope, confirmed against real code (not re-litigated)

- Corpus-wide re-embedding orchestration on a provider switch: **already implemented** (`reembedCorpus`, 002, wired in `main.ts`'s `onload`). 004 does not build this.
- The 3-way embedding-provider selector UI/settings field (`embeddingProvider`, `localEmbeddingModel`): **already implemented** (002). 004 only adds the LLM credential field alongside it.
- `main.ts` lifecycle/lifecycle lint (registerInterval, etc.): untouched by 004 — this feature adds no listener, interval, or timer.
