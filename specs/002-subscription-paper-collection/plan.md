# Implementation Plan: Subscription-Based Paper Collection

**Branch**: `002-subscription-paper-collection` | **Date**: 2026-07-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-subscription-paper-collection/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Collect new papers from arXiv (discovery, Atom XML) and Semantic Scholar (citation enrichment only, JSON) on behalf of each registered subscription (001), on a per-subscription timer while the plugin runs, and as a single bounded catch-up search per enabled subscription when the plugin loads after being off. Every discovered response is parsed into a `PaperCandidate` (001), optionally enriched with citation data (arXiv-ID match, falling back to title+first-author), then promoted to a `Paper` only once it has a publication year — missing citation data never holds a paper back, it is promoted immediately with `citationsKnown = false` so it is never lost by advancing past the search window. This feature owns the end-to-end per-paper pipeline (enrich → optionally invoke summarization 003/004 hook → hand off to persistence 003) but implements none of those downstream steps itself, and is the *only* place in the plugin that makes an external network call.

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: None new for HTTP — Obsidian's `requestUrl` (from the external `obsidian` package, already a project dependency) is used for arXiv/Semantic Scholar calls instead of `fetch`/Node `http`, since it works identically on desktop and mobile and avoids CORS restrictions `fetch` hits in the Obsidian sandbox. Atom XML (arXiv) is parsed with the DOM `DOMParser`, which is available in both the desktop (Electron/Chromium) and mobile (Capacitor/WebView) Obsidian runtimes — no new XML-parsing library is introduced.

**Storage**: N/A for this feature — it reads `Subscription.lastCheckedAt` (001) and writes back an updated value, but persisting the subscription list itself and writing collected papers (JSON record + Markdown note) is 003's responsibility. This feature holds only in-memory per-run state (in-flight dedupe set, retry counters).

**Testing**: No test runner is configured in this repo (confirmed in `CLAUDE.md`/`package.json`), consistent with 001. Correctness is verified via (a) `tsc --noEmit` strict type-checking, (b) pure-function unit coverage of the Atom XML / Semantic Scholar JSON parsers and the candidate→Paper promotion/enrichment logic using this repo's existing `spec-test` convention (stubbed provider payloads, no live network), and (c) a manual `quickstart.md` walkthrough. See `research.md` for rationale.

**Target Platform**: Obsidian desktop + mobile (plugin must stay mobile-compatible; `requestUrl` + `DOMParser` are both available on mobile, so this feature introduces no desktop-only APIs)

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (matches existing `src/main.ts` entry point / single-project layout)

**Performance Goals**: N/A hard targets — the constraint that matters is UI responsiveness: a large discovered batch (Edge Cases: right after registering a subscription, or a long off-period catch-up) must be processed sequentially (not in a tight synchronous loop) so Obsidian's UI thread never freezes.

**Constraints**: Must not depend on Node/Electron-only networking (mobile-compatible per constitution Principle I); every network call this feature makes MUST be disclosed per constitution Principle IV (README + settings UI describe what is called, why, and that it is opt-in via enabling a subscription); MUST NOT let any other module make external calls (FR-008); MUST NOT persist raw provider payloads (FR-008); `tsc --noEmit` and `eslint .` must keep passing repo-wide.

**Scale/Scope**: A handful of new modules under a new `src/collection/` directory — one file per provider client (arXiv, Semantic Scholar), one for Atom/JSON parsing-to-candidate mapping, one for the enrichment/promotion pipeline, one for the per-subscription scheduler (timers + catch-up-on-load), one for the sequential batch-processing queue. Each stays within the constitution's ~300-line split guidance; no existing files are modified except `src/main.ts` gaining scheduler start/stop wiring in `onload`/`onunload`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | Networking uses `requestUrl` (obsidian package, already external/bundled-by-host) and `DOMParser`/`JSON.parse` — no Node/Electron-only APIs, so behavior is identical on desktop and mobile. **Pass.** |
| II. Lifecycle-Safe Resource Management | Applies (NON-NEGOTIABLE) | Per-subscription check timers MUST be created via `this.registerInterval(...)` (or an equivalent cleared in `onunload`) — never a raw `setInterval`. Catch-up-on-load runs once during `onload` and does not itself need a listener. Design in `data-model.md`/`research.md` MUST show the scheduler exposing a start/stop pair the plugin lifecycle owns. **Pass, contingent on Phase 1 design honoring this — re-verified below.** |
| III. Manifest Identity Stability | N/A | `manifest.json` is not touched by this feature. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies | This is the plugin's only feature making network calls (arXiv, Semantic Scholar). Requires: default state is "off" until a subscription is registered (opt-in by construction — no subscriptions means no calls), and README/settings UI copy MUST disclose what is called and why. Tracked as a Phase 1/implementation deliverable, not a design blocker. **Pass, with a documentation obligation carried into tasks.md.** |
| V. Bilingual UX, English-Only Code | Applies | User-facing failure notices (unreachable provider, truncated catch-up window) MUST be understandable to both Korean- and English-speaking users; all code/comments stay English. **Pass — carried into UX copy tasks.** |
| VI. Open-Source Code Quality & Extensibility | Applies | Provider clients, parsing, enrichment/promotion, scheduling, and batch processing are split into separate single-responsibility modules under a new `src/collection/` directory (not `main.ts`), so adding a third provider later extends rather than rewrites this feature. **Pass.** |

No violations identified. Complexity Tracking table below is not needed.

**Post-Phase-1 re-check**: `data-model.md`, `contracts/`, and `quickstart.md` were reviewed against the same six principles after design. The scheduler design registers per-subscription timers through `this.registerInterval(...)` exclusively and exposes an explicit stop path for `onunload`; the only network calls remain confined to the two provider-client modules; no raw provider payload crosses into another module's contract (each contract's output type is the 001 `PaperCandidate`/`Paper` shape). All six principles remain satisfied; no new violations were introduced by the detailed design.

## Project Structure

### Documentation (this feature)

```text
specs/002-subscription-paper-collection/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                       # existing — gains scheduler start (onload) / stop (onunload) wiring only
├── models/                       # existing (001) — Subscription, Paper, PaperCandidate, PluginSettings; read, not modified
└── collection/                   # NEW — this feature's entire footprint
    ├── subscriptionStore.ts       # Subscription[] CRUD (register/list/delete/enable/setInterval) + persistence read/write hook; the settings-screen UI (008) calls this, it builds no UI itself
    ├── arxivClient.ts             # arXiv Atom XML query + response fetch (requestUrl)
    ├── semanticScholarClient.ts   # Semantic Scholar JSON query + response fetch (requestUrl), enrichment lookups
    ├── arxivParser.ts             # Atom XML -> PaperCandidate (citationCount/references left undefined)
    ├── semanticScholarParser.ts   # Semantic Scholar JSON -> citation data merged into a PaperCandidate
    ├── enrichment.ts              # arXiv-ID-first / title+author-fallback identity matching; terminal-absence vs transient-failure classification
    ├── promotion.ts               # PaperCandidate -> Paper gate (delegates to 001's toPaper()/isValidPaper()), citationsKnown bookkeeping
    ├── dedupe.ts                  # per-run sourceId dedupe across subscriptions/overlapping windows
    ├── batchQueue.ts              # sequential, non-blocking processing of a discovered batch
    ├── scheduler.ts               # per-subscription next-check timers + single catch-up-on-load pass; owns lastCheckedAt advancement
    └── pipeline.ts                # per-paper orchestration: enrich -> (hook) summarize -> hand off to (hook) persist
```

**Structure Decision**: Single project (no frontend/backend split). All new code lives under a new `src/collection/` directory, one file per responsibility, matching the constitution's single-responsibility module rule and mirroring 001's `src/models/` precedent. `src/main.ts` gains only the two lines needed to start/stop the scheduler through `registerInterval`; no other existing file is modified. `pipeline.ts` calls into 003 (persistence) and 004 (summarization) through narrow function-call hooks defined in this feature's contract, not through direct imports of their internals, so this feature can be implemented and tested (with stub hooks) before 003/004 exist. `subscriptionStore.ts` owns subscription CRUD and persistence (per 008's clarification that 008 builds only the settings-screen UI and calls into the feature that owns the underlying data); this feature's own "management" User Story is therefore satisfied by these functions alone, with no UI, exactly like 001's data-only-no-UI precedent.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
