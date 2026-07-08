# Implementation Plan: Paper Note Persistence (JSON + Markdown)

**Branch**: `develop-feature/003-paper-note-persistence` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-paper-note-persistence/spec.md`

## Summary

Persist every collected/updated paper as two synchronized on-disk representations inside the user-designated storage folder: a canonical **JSON record** (the plugin's source of truth — a versioned "wrapped superset" of the 001 `Paper`) and a user-facing **Markdown note** (YAML frontmatter + a delimited managed body block that mirror the record, plus a free-form body owned entirely by the user). The two are created, updated (field-scoped merge), and deleted (tombstoned two-phase) as one coordinated, per-paper-serialized operation, and are reconciled JSON-authoritatively on next touch. A session-long in-memory index (lightweight metadata only — no embedding vectors resident) serves the read/query API that 002 (dedup), 005 (read-back), and 006 (enumeration) depend on. Technical approach: a small **FileStore port** (Obsidian Vault adapter for production, in-memory fake for offline verification) under a pure persistence core (record wrap/unwrap + migration, note serialize/parse, filename sanitization, index, reconciliation, per-paper write serialization), keeping file-I/O side effects at the edge and the testable logic pure.

## Technical Context

**Language/Version**: TypeScript 5.8, `strict: true` (existing `tsconfig.json`: ES2021 target, ESNext modules, `noUncheckedIndexedAccess`)

**Primary Dependencies**: `obsidian` API (`Vault`/`DataAdapter` for file read/write/list/delete; `normalizePath`; `parseYaml`/`stringifyYaml` for frontmatter; `Notice` for user messages) — marked external, not bundled. The 001 models (`Paper`, `PaperSourceId`, `isValidPaper`) from `src/models/paper.ts`. No new third-party runtime dependency.

**Storage**: Vault files under the designated folder — one `.json` record + one `.md` note per paper (per-paper sidecars), plus a regenerable projection-basis cache (006) and short-lived per-paper delete tombstones. Authoritative state is on disk; the in-memory index is a cache.

**Testing**: No test runner is configured in this repo (per `CLAUDE.md`). Verification is (a) `tsc --noEmit` (gates `npm run build`), (b) `eslint .`, and (c) a manual `quickstart.md` script run via the existing `esbuild` devDependency against an **in-memory FileStore fake** (the persistence core is pure and Obsidian-free), plus (d) a short manual in-vault smoke of the thin Obsidian adapter.

**Target Platform**: Obsidian desktop (the project is desktop-only — `manifest.json` `isDesktopOnly: true`, driven by 006/007). This feature's own code uses only the Obsidian Vault API (no Node/Electron/DOM), so it is platform-agnostic; it simply runs within the desktop-only plugin.

**Project Type**: Obsidian community plugin — single TypeScript bundle via esbuild (single-project layout; new code under `src/persistence/`).

**Performance Goals**: Load-time scan builds the in-memory index for ~1,000 papers in **≤ 2 s**, off the main render path (SC-006); the index build reads only lightweight metadata, never embedding vectors. Per-paper writes are isolated and serialized so one paper's work never blocks or corrupts another.

**Constraints**: All file I/O confined to the designated folder (FR-006); the user's free-form note body is never modified on update nor parsed as state (FR-005/FR-009/FR-010); record↔note stay coordinated (FR-003) with JSON authoritative on reconcile (FR-013); writes to one paper serialized (FR-014); no live file watcher (FR-017, lazy reconcile); no network/telemetry (constitution IV — this feature is fully offline); embedding vectors never mirrored into notes (FR-022/SC-008) and never resident in the index (FR-015).

**Scale/Scope**: Personal-library scale (~1,000+ papers), each a `.json`+`.md` pair. New footprint: a handful of focused modules under `src/persistence/` (record, note, filename, index, tombstone/reconcile, store, filestore port+adapters), each under the ~300-line split threshold.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Applicability | Assessment |
|---|---|---|
| I. Obsidian Platform Compliance | Applies | File I/O uses the Obsidian `Vault` API (no Node/Electron/DOM); modules stay bundle-friendly (only `obsidian` imported, which is external). Nothing wired into `main.ts` here — 008 wires the store into the lifecycle. **Pass.** |
| II. Lifecycle-Safe Resource Management | Applies | This feature registers **no** listeners/intervals — external-change detection is explicitly lazy (FR-017, no live watcher). The load-time index build is invoked by 008 at `onload`; any future opt-in watcher MUST use `this.registerEvent(...)`. **Pass.** |
| III. Manifest Identity Stability | N/A | `manifest.json` is not touched by this feature. **Pass (vacuous).** |
| IV. Transparent Use of Sensitive APIs | Applies | Zero network requests, external fetches, or dynamic code execution; reads/writes only what is necessary strictly inside the designated vault folder (never outside — FR-006). Fully offline. **Pass.** |
| V. Bilingual UX, English-Only Code | Applies | User-facing messages are limited (folder inaccessible, orphan-note report, storage-folder-moved notice); these follow the bilingual/plain-English `Notice` policy. All code identifiers/comments English. **Pass.** |
| VI. Open-Source Code Quality & Extensibility | Applies | Logic is split into focused single-responsibility modules under `src/persistence/` (record, note, filename, index, reconcile, store, filestore), not `main.ts`; the record is a versioned wrapped superset later features extend rather than fork (FR-016). Each file kept under ~300 lines. **Pass.** |

No violations identified. Complexity Tracking table is not needed.

**Post-Phase-1 re-check**: `research.md`, `data-model.md`, `contracts/persistence-api.md`, and `quickstart.md` were reviewed against the same six principles after design. The FileStore-port design keeps all Obsidian/side-effect code at the adapter edge (Principle VI testability), introduces no listeners/intervals (II), no network (IV), confines writes to the designated folder (I/IV), and keeps user-facing strings minimal and bilingual-ready (V). All six principles remain satisfied; no new violations were introduced.

## Project Structure

### Documentation (this feature)

```text
specs/003-paper-note-persistence/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output (/speckit-plan command)
│   └── persistence-api.md
├── checklists/
│   └── requirements.md  # spec quality checklist (pre-existing)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
src/
├── main.ts                  # existing — untouched here; 008 wires the store at onload
├── settings.ts              # existing sample settings tab — untouched here
├── models/                  # 001 — reused (Paper shape lives here)
│   └── paper.ts
└── persistence/             # NEW — this feature's entire footprint
    ├── record.ts             # PaperRecord (wrapped superset), schemaVersion, wrap/unwrap, migrate()
    ├── note.ts               # note serialize/parse: frontmatter + managed body block + user body
    ├── filename.ts           # injective sourceId -> filename-stem sanitization
    ├── index.ts              # in-memory Record Index (lightweight entries; no embedding vectors)
    ├── reconcile.ts          # orphan/tombstone reconciliation, JSON-authoritative repair
    ├── store.ts              # PaperStore: load/upsert/get/has/all/delete + per-paper write serialization
    └── filestore.ts          # FileStore port + ObsidianFileStore adapter + InMemoryFileStore fake
```

**Structure Decision**: Single project (one Obsidian plugin bundle; no frontend/backend split). All new code lives under a new `src/persistence/` directory, one responsibility per file per constitution Principle VI. The pure core (record/note/filename/index/reconcile/store) depends only on a small `FileStore` port; the production `ObsidianFileStore` adapter is the sole holder of Obsidian I/O side effects, and an `InMemoryFileStore` fake makes the whole core runnable offline for `quickstart.md`. Nothing in `src/main.ts`/`src/settings.ts` changes — wiring the store into the plugin lifecycle (load-time index build, settings-driven folder) is 008's job (spec Out of Scope).

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

Not applicable — the Constitution Check above found no violations.
