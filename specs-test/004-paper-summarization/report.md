# Spec-test report: 004-paper-summarization

> **[Re-run 2026-07-17 — 25 passed, 0 failed, 3 skipped]**
>
> The LLM embedding assertions (`FR-011`, `EMB.1`–`EMB.5`, and the `isCanonical-direct`
> / `smoke-openai` skips) are removed: that provider is retired and the code under test
> no longer exists. `FR-013` now asserts the embedding disclosure copy is *absent* —
> a Principle IV disclosure outliving its data path is how the copy starts lying about
> what leaves the vault. Every summarization case is unchanged and still passes.

- **Spec**: `specs/004-paper-summarization/spec.md`
- **Source branch**: `develop-feature/embedding-redesign`
- **Date**: 2026-07-17
- **`tsc --noEmit`**: PASS
- **Result**: **25 passed, 0 failed, 3 skipped**

Verifies the current `src/services/summarization/*` implementation (plus the settings
fields and the two additive `src/collection/*` seam completions this feature owns)
against the spec's acceptance scenarios, success criteria, and edge cases.
**Deterministic**: every `SummarizationProvider`/`LlmEmbeddingProvider` is an
in-process fake, so no live network call is ever made — `_obsidian-shim.ts` provides a
`requestUrl` that *throws* unless a case explicitly injects one canned response (the
`PARSE.*` cases do this via `__setNextResponse` to exercise `openAiProvider.generate`'s
marker-parsing without a network call), guaranteeing the asserted cases never touch the
real OpenAI API. The bounded 20s generation/embedding timeout is exercised without
waiting by firing `window.setTimeout` callbacks immediately for those two cases
(`withImmediateTimers`). Scenarios owned by the 002 pipeline (enabled-flag gating,
in-flight discard), 003 note rendering, and `reembed.ts`'s module-private
`isCanonical()` are recorded as SKIP with a reason — the pure logic 004 owns is
asserted directly.

| id | scenario / SC | status | note |
|----|---------------|--------|------|
| US1.1/SC-001 | Unconfigured provider → undefined, no call | PASS | FR-001/FR-006 |
| US1.2 | Missing/whitespace credential → undefined, no call | PASS | treated as not configured |
| US1.3/SC-001 | Valid summary, cited paper → { summary, futureDirections: '' } | PASS | FR-002/FR-003 |
| US1.4 | Empty/too-short summary → undefined (abstract fallback) | PASS | FR-007, 20-char threshold |
| US1.5 | Generic provider rejection → undefined | PASS | FR-007, no unhandled rejection |
| US1.6 | Timeout → undefined, not a credential problem | PASS | FR-007/FR-012, bounded via AbortSignal |
| US1.7/SC-004 | Return shape is exactly undefined or {summary, futureDirections} | PASS | no free-form body field exists on the shape |
| US2.1/SC-002 | Uncited paper → summary AND future-directions | PASS | FR-004 |
| US2.2/SC-002 | Cited paper → summary only; provider FD discarded | PASS | FR-004 gating in hook.ts |
| US2.3 | Uncited, FD too-short → degrade to '', keep summary | PASS | research.md §2 |
| EC-uncited | isUncited: confirmed-0 only; unknown-0 and positive are not | PASS | 002 FR-016/FR-018 |
| EC-uncited-wired | Unknown-status paper gets no future-directions through the hook | PASS | citationsKnown:false → summary only |
| US3.1 | Invalid credentials → undefined AND notify called once | PASS | FR-008 (summarization path) |
| US3.2 | Provider swappable — same factory, two ids | PASS | Principle VI |
| FR-011 | Summarization and embedding toggles independent | PASS | each works with the other unconfigured |
| EMB.1 | Missing embedding credential → undefined, no call | PASS | FR-010 |
| EMB.2 | Success → `llm:<model>:d<dim>`, source 'llm' | PASS | data-model.md §5 naming contract |
| EMB.3 | Invalid vector (empty / non-finite) → undefined | PASS | FR-012 |
| EMB.4 | Embedding rejection / invalid-credentials → undefined | PASS | FR-012, never throws |
| EMB.5 | Embedding timeout → undefined | PASS | FR-012, never blocks persistence |
| PARSE.1 | Exact "Future directions:" marker splits summary/future-directions | PASS | openAiProvider.generate, canned response |
| PARSE.2 | Capitalized "Future Directions", no colon → still splits | PASS | tolerant match (line-anchored, case-insensitive) |
| PARSE.3 | Bold "**Future directions:**" → clean split | PASS | markdown emphasis does not leak into summary |
| PARSE.4 | No marker → summary only, no future-directions | PASS | graceful fallback |
| FR-013 | Disclosure copy names title+abstract and plaintext storage | PASS | Principle IV |
| EC-inflight-discard | Toggle-off mid-generation discards in-flight result | SKIP | pipeline.ts re-check (002); hook has no enabled-flag |
| SC-001-pipeline | Feature off → zero calls during a real collection pass | SKIP | enabled-gate lives in pipeline.ts (002) |
| SC-004-render | Text lands only in the managed region, not the user body | SKIP | placement is 003's renderProse(); shape asserted in US1.7 |
| isCanonical-direct | reembed.ts isCanonical() true for an `llm:` model | SKIP | isCanonical() is module-private; predicate asserted via EMB.2 |
| smoke-openai | Real OpenAI provider/embedding round-trip | SKIP | network-touching requestUrl; quickstart.md manual smoke |

## Known residual limitations

Behaviors observed during derivation that this suite does not assert as failures —
they are outside the spec's asserted guarantees, but recorded for the spec author:

- **Embedding credential rejection is silent (asymmetric with summarization).** A
  rejected *summarization* credential calls `notifyCredentialProblem` (US3.1), but a
  rejected *LLM embedding* credential (EMB.4) resolves `undefined` with **no user
  notification** — `llmEmbeddingUpgrade` has no notify callback threaded to it, and
  the `embeddingUpgrade.ts`/`reembed.ts`/`pipeline.ts` call chain that reaches it is
  002-owned. FR-012 requires only fallback (not notification), and FR-008/US3's
  informing requirement is written against the summarization path, so this is not a
  spec violation today — but a user who mistypes their embedding API key silently
  stays on the baseline forever. Whether to surface it is a spec decision (would
  require FR-008 to be broadened and a notify seam threaded through the 002 embedding
  dispatcher).
- **Future-directions parsing tolerates marker variants but is still heuristic.**
  `providers/openai.ts` now splits on a line-anchored, case-insensitive
  `future directions` marker that also absorbs surrounding markdown emphasis
  (`#`/`*`/`_`) and an optional colon — PARSE.1–4 assert exact, capitalized-no-colon,
  bold, and no-marker cases against `openAiProvider.generate` via a canned response.
  A model that phrases the section entirely differently (e.g. "Open problems") still
  yields summary-only, which is graceful and never an error.
- **The 20s timeout does not sever the in-flight HTTP request.** `requestUrl` has no
  cancellation, so `withTimeout` only stops *waiting* on it (documented in
  `generate.ts`). FR-007/FR-012 ("never block") are satisfied; the socket may linger.

## Raw test run

```text
[PASS] US1.1/SC-001 — Unconfigured provider → undefined, generate never called
[PASS] US1.2 — Missing/empty credential → undefined, generate never called
[PASS] US1.3/SC-001 — Configured + valid summary → { summary, futureDirections: "" } for a cited paper
[PASS] US1.4 — Empty/too-short summary → undefined (abstract fallback)
[PASS] US1.5 — Provider rejects (generic) → undefined, no unhandled rejection
[PASS] US1.6 — Timeout → undefined (never blocks note creation)
[PASS] US1.7/SC-004 — Resolved value is always exactly undefined or { summary, futureDirections } — no body field
[PASS] US2.1/SC-002 — Uncited paper → summary AND future-directions text
[PASS] US2.2/SC-002 — Cited paper → summary only, provider future-directions discarded
[PASS] US2.3 — Uncited, future-directions too-short → degrade to "", keep the summary
[PASS] EC-uncited — isUncited: confirmed-zero only; unknown zero and positive are not uncited
[PASS] EC-uncited-wired — The uncited gate flows through the hook (unknown-status paper gets no future-directions)
[PASS] US3.1 — Invalid credentials → undefined AND notifyCredentialProblem called exactly once
[PASS] US3.2 — Provider is swappable — same hook factory, two different provider ids
[PASS] FR-011 — Summarization and embedding toggles are independent
[PASS] EMB.1 — Missing credential → undefined, embed never called
[PASS] EMB.2 — Success → embeddingModel is llm:<model>:d<dim>, embeddingSource is "llm"
[PASS] EMB.3 — Invalid vector (empty / non-finite) → undefined
[PASS] EMB.4 — Provider rejection / invalid-credentials → undefined, never throws
[PASS] EMB.5 — Timeout → undefined (never blocks persistence)
[PASS] FR-013 — Disclosure copy names what is sent (title+abstract) and plaintext storage
[PASS] PARSE.1 — Exact "Future directions:" marker splits summary/future-directions
[PASS] PARSE.2 — Capitalized "Future Directions" without a colon → still splits
[PASS] PARSE.3 — Bold "**Future directions:**" → clean split, emphasis stays out of the summary
[PASS] PARSE.4 — No marker → summary only, no future-directions
[SKIP] EC-inflight-discard — Toggling the feature off mid-generation discards the in-flight result (FR-009)
[SKIP] SC-001-pipeline — With the feature off, zero summarization calls are made during a real collection pass
[SKIP] SC-004-render — Generated text lands only in the note's managed region, never the user body
[SKIP] isCanonical-direct — reembed.ts isCanonical() returns true for an llm:-prefixed model
[SKIP] smoke-openai — The real openAiProvider/openAiEmbeddingProvider round-trip against OpenAI

Summary: 25 passed, 0 failed, 5 skipped
```
