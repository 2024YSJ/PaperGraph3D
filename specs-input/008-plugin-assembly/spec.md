# Feature Specification: Plugin Assembly, Lifecycle & Settings

**Feature Branch**: `008-plugin-assembly`

**Created**: 2026-07-04

**Status**: Draft

**Input**: "Assemble every feature into a single plugin and provide the entry points through which the user turns it on, off, and configures it. The user can open the graph view via an icon or command and manage subscriptions, storage location, summarization, and graph display options from one settings screen with four sections. On load, features initialize in the correct order — including triggering the catch-up collection for the time the plugin was off. On unload, all background work stops cleanly. This feature contains no new decision logic of its own; it only connects existing features."

## Clarifications

### Session 2026-07-04

- Q: The plugin does no background collection while off — what makes the off-period papers get collected? → A: On load, this feature initializes the collection feature (002) and triggers its catch-up pass, which searches each enabled subscription's window from its last-checked time to now. This feature owns *when* catch-up is triggered (at load, in order); 002 owns *how* the catch-up search works.
- Q: On unload, what must stop? → A: All automatically running work — the periodic subscription-check timers/intervals and any in-flight scheduled work — must be fully cleaned up so nothing runs after the plugin is off. This is the mechanism that guarantees "no collection while off."
- Q: Does this feature make any of its own product decisions? → A: No. It only wires features together, initializes them in order, exposes entry points (icon/command, settings), and cleans up. Every behavioral decision lives in the feature that owns it.

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

---

### User Story 3 - Clean shutdown (Priority: P1)

As a user, I want any background work (like periodic subscription checks) to stop cleanly when I turn the plugin off.

**Why this priority**: Clean unload is what enforces the "no collection while off" rule and prevents leaks; it is a platform-compliance necessity.

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

### Key Entities

- **Plugin Lifecycle**: The load/unload sequence — ordered initialization (including triggering 002's catch-up) and complete teardown of scheduled work.
- **Settings Screen**: The single configuration surface with four sections, each delegating to the owning feature's behavior.
- **Entry Points**: The icon and command that open the graph view.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Turning the plugin on immediately after installation opens the graph view without errors, using default settings.
- **SC-002**: Loading the plugin after an off period triggers exactly one catch-up collection pass (delegated to 002) so off-period papers are collected.
- **SC-003**: Changes made in any of the four settings sections are reflected in actual behavior.
- **SC-004**: No background work continues to run after the plugin has been turned off (0 scheduled tasks surviving unload).
- **SC-005**: This feature adds zero new product decisions; every behavior traces to an owning feature.

## Assumptions

- The correct initialization order follows the feature dependency chain: 001 → settings → 003 → 004 → 002 → 006 → 007, with 005 available on demand. Because 002 owns the per-paper pipeline that invokes 004 (summarize) and 003 (persist), both 003 and 004 MUST be initialized before 002's catch-up pass is triggered; assembly encodes this order.
- Scheduled work uses the platform's registration mechanisms that auto-clean on unload, satisfying the clean-shutdown requirement and the "no collection while off" rule together.
- The default storage location and other defaults come from 001; this feature does not redefine them.
- Each settings section renders fields owned by the corresponding feature — including the summarization provider and credentials, which are 004's extension fields (001 FR-016). This feature only surfaces them; their meaning and validation belong to the owning feature.
- User-facing notifications use the platform's standard notice mechanism; each feature owns the wording and timing of its own messages (002 provider failures, 003 folder access, 004 credentials, 005 refresh outcome, 007 empty search). This feature does not centralize them, consistent with holding no product logic of its own.

## Open Questions

*Deferred to `/speckit.clarify` and `/speckit.plan` — recorded so refinement and planning address them. None are settled yet.*

- **OQ-1 — Settings migration/versioning** across schema changes (record migration is 003 OQ-10; this is the settings counterpart).
- **OQ-2 — Surfacing per-feature extension settings.** How the four-section settings screen renders feature-owned extension fields (e.g. 004's provider/credentials) — a generic mechanism or per-feature custom sections.

## Out of Scope

- The actual behavior logic of each individual feature is owned by that feature (002–007). This feature covers only connection, initialization, entry points, settings surface, and cleanup.
