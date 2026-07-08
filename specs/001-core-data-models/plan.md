# Implementation Plan: Core Data Structures

**Branch**: `001-core-data-models` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-core-data-models/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Define fixed TypeScript shapes and runtime validators for the three data structures every later PaperGraph3D feature depends on: **Subscription** (tracked keyword/author/arXiv-category search with a restricted check interval), **Paper** (a collected academic paper, with publication year as a hard, never-empty requirement and a "hold back" rule for papers missing one), and **Plugin Settings** (storage location, summarization toggle, graph display options, all resolving to concrete non-empty defaults). This feature produces types and pure validation/construction functions only — no UI, no persistence wiring, no network calls. Per clarification, the shape is an **open baseline**: later features (citation relationships, read/unread state, etc.) may add attributes without requiring changes here, and a paper's `sourceId` is a provider-tagged, globally-unique string (e.g. `arxiv:2301.12345`) that doubles as the deduplication key referenced by the collection, note-saving, refresh, and graph-conversion features documented in the downstream spec notes at `C:\Users\윤성진\Documents\Obsidian Vault\AIO\대학 중 기록\3-1_takeoff\Papergraph\개발 일지\260702\spec`. (Post-001 additive extensions to `Paper`: `references` — outbound citations, FR-016 — and the core content-similarity fields `embedding`/`embeddingModel`/`embeddingSource` — FR-019/FR-020/FR-021, added 2026-07-07; see `data-model.md`.)

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: None new. No runtime dependency on the `obsidian` package is needed or introduced — these modules must stay pure so they can be unit-exercised without an Obsidian host.

**Storage**: N/A — this feature defines the shape of data and its defaults only; actually persisting it via `this.loadData()`/`this.saveData()` is explicitly out of scope (a later feature wires that up).

**Testing**: No test runner is configured in this repo (confirmed in `CLAUDE.md`/`package.json`). This feature adds none. Correctness is verified via (a) `tsc --noEmit` strict type-checking of the new modules (already required by `npm run build`), and (b) a manual `quickstart.md` walkthrough that runs the exported validators against representative valid/invalid sample records using the existing `esbuild` devDependency (no new tooling). See `research.md` for rationale.

**Target Platform**: These 001 modules are pure data (no Node/Electron/DOM APIs) and run anywhere. **Project-level update (2026-07-07)**: PaperGraph3D later committed to **desktop-only** (`manifest.json` `isDesktopOnly: true`) because features 006/007 need native local embedding + 3D rendering; that project decision does not affect these pure 001 modules, which remain platform-agnostic.

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (matches the existing `src/main.ts` entry point / single-project layout)

**Performance Goals**: N/A — plain object shapes and O(1)/O(n) pure validation functions over small in-memory records; no performance-sensitive paths in this feature

**Constraints**: Must not depend on `obsidian`, Node, or Electron APIs (mobile-compatible by default per constitution Principle I); must not perform any I/O or network calls (constitution Principle IV — this feature has no user-facing reason to call out, so it must stay fully offline); `tsc --noEmit` and `eslint .` must both keep passing repo-wide

**Scale/Scope**: 3 entity modules (~6 attributes each) plus their validators/constants — a handful of new files under `src/models/`, each well under the constitution's ~300-line split threshold; no existing files are modified

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | New files are plain TypeScript with zero imports from `obsidian`/`electron`/Node built-ins; `tsc --noEmit` + esbuild bundling are unaffected since nothing new is wired into `main.ts` yet. **Pass.** |
| II. Lifecycle-Safe Resource Management | N/A | No event listeners, DOM listeners, or intervals are introduced — this feature is data shapes and pure functions only. **Pass (vacuous).** |
| III. Manifest Identity Stability | N/A | `manifest.json` is not touched by this feature. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies | No network requests, external data fetches, or dynamic code execution are introduced. **Pass.** |
| V. Bilingual UX, English-Only Code | Applies | This feature has no user-facing UI text (out of scope by spec). All identifiers/comments in the new modules are English. **Pass.** |
| VI. Open-Source Code Quality & Extensibility | Applies | Design places each entity in its own single-responsibility file under `src/models/` (not `main.ts`), and the spec's own extensibility clarification (FR-016) is carried into the type design so later features can add fields without editing these files' fixed core. **Pass.** |

No violations identified. Complexity Tracking table below is not needed.

**Post-Phase-1 re-check**: `data-model.md`, `contracts/data-model-api.md`, and `quickstart.md` were reviewed against the same six principles after design. The finalized design still introduces zero `obsidian`/Node/Electron imports, zero listeners/intervals, zero network calls, and zero UI text, and keeps each entity in its own file under `src/models/`. All six principles remain satisfied; no new violations were introduced by the detailed design.

## Project Structure

### Documentation (this feature)

```text
specs/001-core-data-models/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md         # Phase 1 output (/speckit-plan command)
├── quickstart.md         # Phase 1 output (/speckit-plan command)
├── contracts/            # Phase 1 output (/speckit-plan command)
│   └── data-model-api.md
└── tasks.md              # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts               # existing — untouched by this feature
├── settings.ts            # existing sample settings tab — untouched by this feature
└── models/                # NEW — this feature's entire footprint
    ├── subscription.ts     # Subscription type, CheckIntervalHours, isValidSubscription()
    ├── paper.ts             # Paper type, PaperCandidate type, toPaper()/isValidPaper()
    └── settings.ts           # PluginSettings type, DEFAULT_PLUGIN_SETTINGS, isValidPluginSettings()
```

**Structure Decision**: Single project (this repo has no frontend/backend or mobile split — it is one Obsidian plugin bundle). All new code lives under a new `src/models/` directory, one file per entity, matching the constitution's "focused, single-responsibility modules under `src/`" rule. Nothing in `src/main.ts` or the existing `src/settings.ts` (still the stock sample settings tab) is modified: wiring these types into the plugin's actual lifecycle/persistence/UI is explicitly out of this spec's scope (`spec.md` "Out of Scope") and is left to later features. No `tests/` directory is added — see Technical Context/Testing above and `research.md` for why.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
