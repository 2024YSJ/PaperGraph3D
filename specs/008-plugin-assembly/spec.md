# Feature Specification: Plugin Assembly, Lifecycle & Settings

**Feature Branch**: `008-plugin-assembly`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Assemble every feature into a single plugin and provide the entry points through which the user turns it on, off, and configures it. The user can open the graph view via an icon or command and manage subscriptions, storage location, summarization, and graph display options from one settings screen with four sections. On load, features initialize in the correct order — including triggering the catch-up collection for the time the plugin was off. On unload, all background work stops cleanly. This feature contains no new decision logic of its own; it only connects existing features." (Graduates the `specs-input/008-plugin-assembly` draft, reconciled against the current codebase: fixed on-device SPECTER2 embedding per constitution v1.3.0 — no three-way embedding-provider selector — and English-only UX per constitution v2.0.0.)

## Clarifications

### Session 2026-07-04

- Q: The plugin does no background collection while off — what makes the off-period papers get collected? → A: On load, this feature initializes the collection feature (002) and triggers its catch-up pass, which searches each enabled subscription's window from its last-checked time to now. This feature owns *when* catch-up is triggered (at load, in order); 002 owns *how* the catch-up search works.
- Q: On unload, what must stop? → A: All automatically running work — the periodic subscription-check timers/intervals and any in-flight scheduled work — must be fully cleaned up so nothing runs after the plugin is off. This is the mechanism that guarantees "no collection while off."
- Q: Does this feature make any of its own product decisions? → A: No. It only wires features together, initializes them in order, exposes entry points (icon/command, settings), and cleans up. Every behavioral decision lives in the feature that owns it.

### Session 2026-07-26 (reconciliation)

- Q: The draft assumed a three-way embedding-provider selector (bundled / local-transformer / LLM) plus per-provider credentials. Is that still the model? → A: **No — reconciled against the codebase.** The project moved to a **single fixed on-device embedding model, SPECTER2** (`specter2-proximity-onnx`; constitution v1.3.0). There is no embedding-provider selector and no LLM/embedding-provider credential. The summarization section surfaces only the summarization toggle, provider, and its credential (004); the embedding path is unconditional on-device SPECTER2 with a one-time opt-in **model download** control (002 FR-046, surfaced here). FR-010/FR-011 and the Assumptions are reworded accordingly.
- Q: What credentials does the settings screen actually surface? → A: Two, both masked (FR-010): the optional **Semantic Scholar API key** (002 extension field) in the subscriptions/collection section, and the **LLM summarization API key** (004 extension field) in the summarization section. arXiv needs none, so no arXiv key field is presented.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install, turn on, and use immediately (Priority: P1)

As a user, I want to install the plugin, turn it on, and start using it right away with sensible defaults and no required setup.

**Why this priority**: If assembly and initialization are wrong, no other feature is reachable; this is the integration keystone.

**Independent Test**: Enable the plugin on a fresh vault and confirm it loads without error, resolves default settings (from 001), initializes features in order, and can open the graph view.

**Acceptance Scenarios**:

1. **Given** a freshly installed plugin, **When** it is turned on, **Then** it loads with the complete default settings from 001 and requires no setup before the graph view can open.
2. **Given** the plugin is on, **When** the user activates the icon or command, **Then** the graph view opens without errors.
3. **Given** the plugin loads after having been off, **When** initialization runs, **Then** the collection feature's catch-up pass is triggered so off-period papers are collected.

---

### User Story 2 - Configure everything from one settings screen (Priority: P2)

As a user, I want to manage subscriptions, storage location, summarization settings, and graph display options all from one settings screen.

**Why this priority**: A single coherent settings surface is how the user actually controls the assembled features.

**Independent Test**: Open settings and confirm four sections exist (subscriptions, storage location, summarization, graph display options), and that a change in each is reflected in the corresponding feature's behavior.

**Acceptance Scenarios**:

1. **Given** the settings screen, **When** it is opened, **Then** it presents four sections: subscriptions, storage location, summarization, and graph display options.
2. **Given** a change in any section, **When** it is saved, **Then** the change is reflected in the corresponding feature's actual behavior.
3. **Given** the subscriptions section, **When** it is opened, **Then** each subscription exposes its check interval (one of 002's allowed values, default 24h), an enabled toggle, and a historical-backfill start point ("collect from this date onward"), and the section also exposes a global automatic-collection on/off control — all delegating to 002's behavior.
4. **Given** any credential field (the Semantic Scholar API key or the LLM summarization API key), **When** it is rendered, **Then** it is a masked input that never shows or logs the stored value in plaintext and carries the owning feature's disclosure copy; **and** no arXiv key field is presented, since arXiv needs none.

---

### User Story 3 - Clean shutdown (Priority: P1)

As a user, I want any background work (like periodic subscription checks) to stop cleanly when I turn the plugin off.

**Why this priority**: Clean unload is what enforces the "no collection while off" rule and prevents leaks; it is a platform-compliance necessity (constitution Principle II).

**Independent Test**: Turn the plugin on so a periodic check is scheduled, turn it off, and confirm no scheduled/background work continues to run.

**Acceptance Scenarios**:

1. **Given** the plugin is running with a scheduled subscription check, **When** it is turned off, **Then** all automatically running work is fully cleaned up.
2. **Given** the plugin has been turned off, **When** time passes, **Then** no background collection or other automatic work runs.

---

### Edge Cases

- If a required setting (such as storage location) is empty when the plugin is turned on, the user must be guided to set it (though 001 guarantees a concrete default, so this applies if a user has cleared it).
- If the plugin is turned off while a setting change is in progress, the previous settings must not be corrupted.
- If catch-up collection triggered at load fails (provider unreachable), the failure is surfaced per 002 and does not block the rest of initialization or the graph view.
- Features must initialize in an order that respects their dependencies (data models → settings → persistence → collection → summarization → graph data → view); assembly owns this ordering.
- If the on-device SPECTER2 model is not yet downloaded when collection runs, papers are embedded with the offline baseline (002 FR-045) and are re-embedded later by 002's background pass once the model is present; assembly must not block on the download.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The user MUST be able to open the graph view via an icon or a command.
- **FR-002**: The settings screen MUST be organized into four sections: subscriptions, storage location, summarization, and graph display options.
- **FR-003**: When the plugin is turned on, every feature MUST be initialized in the correct dependency order, and the collection feature's catch-up pass (for the off-period window) MUST be triggered as part of load. The catch-up pass MUST be triggered only after the features its per-paper pipeline depends on — persistence (003) and, when enabled, summarization (004) — are initialized.
- **FR-004**: When the plugin is turned off, all automatically running work (such as periodic subscription checks and scheduled timers) MUST be fully cleaned up so nothing runs after unload.
- **FR-005**: This feature MUST contain no new decision-making logic of its own; it only connects, initializes, and cleans up existing features and exposes their entry points.
- **FR-006**: Changes made in any of the four settings sections MUST be reflected in the corresponding feature's actual behavior.
- **FR-007**: If a required setting is empty at load, the user MUST be guided to set it; the plugin MUST NOT proceed into a broken state.
- **FR-008**: If the plugin is turned off while a setting change is in progress, previously saved settings MUST NOT be corrupted.
- **FR-009**: A failure in load-time catch-up collection MUST NOT block initialization of the remaining features or prevent the graph view from opening; it is surfaced per 002.
- **FR-010** *(sensitive-credential fields)*: Every credential the settings screen surfaces — the optional Semantic Scholar API key (a 002 extension field, 002 FR-020) and the LLM summarization API key (a 004 extension field, 004 FR-010) — MUST be rendered as a masked/password input, MUST NOT display or write the stored value to logs or notices in plaintext, and MUST carry the owning feature's disclosure copy: what the key is sent to, that it is optional, that the plugin works fully without it, and that it is persisted unencrypted in the vault's plugin data (constitution Principle IV). arXiv requires no credential (it is queried unauthenticated), so the settings screen MUST NOT present an arXiv key field. This feature only places these controls and their disclosure copy; the copy wording and any validation belong to the owning feature (002/004).
- **FR-011** *(collection cadence & history-window controls)*: The subscriptions/collection section MUST surface, per subscription, the check interval (one of 002's allowed values — 6/12/24/48/72h, default 24h — 002/`subscription.ts`), the per-subscription enabled toggle, and a historical-backfill start point ("collect papers from this instant onward") that drives 002's backfill (002 US5, FR-033–043); it MUST also surface a global automatic-collection on/off control (002's scheduler `autoStart`) and the ability to cancel a running backfill (002 FR-043). This feature only places these controls; the allowed interval values, the backfill window mechanics, and every collection behavior are owned by 002 and MUST NOT be re-decided here (FR-005).
- **FR-012** *(manual-refresh entry points, no schedule control)*: The manual single-paper refresh (005 FR-001), the bulk "refresh every paper published within the last year" action (005 FR-009), and bulk-refresh cancellation (005 FR-022) MUST be reachable as command/menu entry points (alongside, or in addition to, 007's graph right-click surface). Because refresh is manual-only by definition (005 FR-007), the settings screen MUST NOT present any refresh interval, schedule, or auto-refresh control. If 005's large-matched-set confirmation gate (005 FR-018b) is surfaced, this feature only places the confirmation prompt; its threshold and behavior are owned by 005.
- **FR-013** *(on-device embedding-model control)*: The summarization section MUST surface a control to download the fixed on-device SPECTER2 embedding model (~130 MB, one-time, opt-in) and MUST show its installed/not-installed state, delegating the download and disclosure to 002 (FR-046, constitution Principle IV). It MUST NOT present any embedding-provider selector or embedding credential — embedding is unconditionally on-device SPECTER2 (constitution v1.3.0). Collection MUST NOT be blocked while the model is absent (the offline baseline is used and later re-embedded; 002 FR-045).

### Key Entities

- **Plugin Lifecycle**: The load/unload sequence — ordered initialization (including triggering 002's catch-up) and complete teardown of scheduled work.
- **Settings Screen**: The single configuration surface with four sections, each delegating to the owning feature's behavior. Sensitive credential fields (Semantic Scholar / LLM API keys) are masked and carry their owning feature's disclosure copy (FR-010); no field is presented for arXiv, which needs no credential; the embedding path is the fixed on-device SPECTER2 model with only a download control (FR-013).
- **Entry Points**: The icon and command that open the graph view, plus the command/menu triggers for the manual single-paper and bulk refresh actions and bulk-refresh cancellation (005), which this feature only surfaces (FR-012).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Turning the plugin on immediately after installation opens the graph view without errors, using default settings.
- **SC-002**: Loading the plugin after an off period triggers exactly one catch-up collection pass (delegated to 002) so off-period papers are collected.
- **SC-003**: Changes made in any of the four settings sections are reflected in actual behavior.
- **SC-004**: No background work continues to run after the plugin has been turned off (0 scheduled tasks surviving unload).
- **SC-005**: This feature adds zero new product decisions; every behavior traces to an owning feature.

## Assumptions

- The correct initialization order follows the feature dependency chain: 001 → settings → 003 → 004 → 002 → 006 → 007, with 005 available on demand. Because 002 owns the per-paper pipeline that invokes 004 (summarize) and 003 (persist), both 003 and 004 MUST be initialized before 002's catch-up pass is triggered; assembly encodes this order.
- Scheduled work uses the platform's registration mechanisms that auto-clean on unload (e.g. `registerInterval`), satisfying the clean-shutdown requirement and the "no collection while off" rule together.
- The default storage location and other defaults come from 001; this feature does not redefine them.
- Each settings section renders fields owned by the corresponding feature. The current model:
  - **Subscriptions / collection**: the subscription list (add/edit/remove; `type` ∈ keyword/author/arxivCategory, `value`, `label`) with a **per-subscription enabled toggle** and **check-interval** selector (6/12/24/48/72h, default 24h — the "collection cadence"), a **historical-backfill start point** ("collect from this instant onward", driving 002's backfill window) with a **cancel-running-backfill** control, a **global automatic-collection on/off** toggle (002's `autoStart`), and the **Semantic Scholar API key** (masked, optional; FR-010). arXiv exposes no key field — it is queried unauthenticated.
  - **Storage location**: the vault folder the record/note pairing is written under (001 default `PaperGraph3D`), owned by 003.
  - **Summarization**: the summarization **enabled** toggle (001 default off, opt-in), the summarization **provider** and its **LLM API key** (masked; FR-010), owned by 004, plus the **on-device SPECTER2 model download** control (FR-013). There is no embedding-provider selector and no separate embedding credential (constitution v1.3.0).
  - **Graph display options**: layout and color-scheme controls owned by 007, plus the persisted **render window** (007 FR-021) that bounds which papers the graph loads by default.
- Sensitive-credential handling (FR-010) is the settings screen's one cross-cutting UI rule and exists because these keys are the only values here that must not leak: mask them, never echo them into logs/notices, and show the owning feature's disclosure copy including that they are stored unencrypted in the vault's plugin data. arXiv is deliberately keyless, so it must never grow a key field.
- Refresh (005) is **manual-only** (005 FR-007): its single-paper, bulk, and cancel actions are surfaced as commands/menu entries (FR-012), and the settings screen intentionally holds **no** refresh-interval or auto-refresh control. The "how often to fetch fresh data" cadence a user might look for lives entirely in the collection section's per-subscription check interval, not under refresh.
- User-facing notifications use the platform's standard notice mechanism; each feature owns the wording and timing of its own messages (002 provider failures, 003 folder access, 004 credentials, 005 refresh outcome, 007 empty search). This feature does not centralize them, consistent with holding no product logic of its own. All user-facing copy is English (constitution v2.0.0).

## Dependencies

- **001 (core data models)**: default settings and the extension fields the settings screen renders. Read/write via the settings surface; no redefinition.
- **002 (collection)**: the subscription store, scheduler (`autoStart`, catch-up), backfill, the Semantic Scholar key field, and the on-device SPECTER2 model download. Assembly triggers and surfaces; 002 owns the behavior.
- **003 (persistence)**: the record/note store initialized before collection; the storage-location setting.
- **004 (summarization)**: the summarize hook (invoked by 002's pipeline), the summarization toggle/provider/credential.
- **005 (manual refresh)**: single/bulk/cancel actions surfaced as commands/menu entries.
- **006 (graph-data conversion)** and **007 (3D visualization)**: the graph view opened by assembly's icon/command; 007 owns the view contents, assembly owns the host-chrome that launches it.

## Open Questions

*Deferred to `/speckit-clarify` and `/speckit-plan` — recorded so refinement and planning address them.*

- **OQ-1 — Settings migration/versioning** across schema changes (record migration is 003's concern; this is the settings counterpart).
- **OQ-2 — Surfacing per-feature extension settings.** Whether the four-section settings screen renders feature-owned extension fields via a generic mechanism or per-feature custom sections.

## Out of Scope

- The actual behavior logic of each individual feature is owned by that feature (002–007). This feature covers only connection, initialization, entry points, settings surface, and cleanup.
- Any new product decision — cadence values, backfill mechanics, embedding model choice, refresh thresholds, color meanings — belongs to the owning feature, not assembly (FR-005).
