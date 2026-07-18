import { Notice, Plugin } from 'obsidian';
import {
	PluginSettings,
	DEFAULT_PLUGIN_SETTINGS,
	PaperGraph3DSettingTab,
} from './settings';
import type { Subscription } from './models/subscription';
import { createSubscriptionStore } from './collection/subscriptionStore';
import { startScheduler, type SchedulerHandle } from './collection/scheduler';
import { runSubscriptionCheck } from './collection/pipeline';
import type { PipelineHooks } from './collection/pipeline';
import { reembedCorpus } from './collection/reembed';
import {
	areAssetsPresent,
	assetPaths,
	downloadAssets,
	resolveModelLocation,
	type AssetProgress,
	type LocalModelLocation,
} from './collection/modelAssets';
import { resetPipeline } from './collection/localTransformer';
import { createObsidianFileStore } from './persistence/filestore-obsidian';
import { PaperStore } from './persistence/store';
import { createSummarizeHook } from './services/summarization/hook';
import { resolveSummarizationProvider } from './services/summarization/providers/registry';

// User-facing copy is English-only (per project decision).
function subscriptionFailureNotice(
	subscription: Subscription,
	reason: 'unreachable' | 'truncated',
): string {
	const label = subscription.label;
	if (reason === 'unreachable') {
		return `PaperGraph3D: Couldn't check subscription "${label}" (provider unreachable). Will retry.`;
	}
	return `PaperGraph3D: Search window for "${label}" was too large to cover at once; the rest continues on the next check.`;
}

function invalidDataNotice(droppedCount: number): string {
	return `PaperGraph3D: ${droppedCount} stored subscription(s) were corrupted and have been ignored.`;
}

// 002 FR-048: informational only — never blocks the backfill, which proceeds
// identically whether or not this Notice is shown.
function largeBackfillWindowNotice(subscription: Subscription): string {
	const label = subscription.label;
	return (
		`PaperGraph3D: "${label}" 백필 범위가 넓어 많은 논문을 가져올 수 있습니다.\n` +
		`The backfill window for "${label}" spans a long period and may collect a large number of papers.`
	);
}

// 004 FR-006/FR-008: summarization is enabled but its provider and/or credential is
// absent, so every paper silently falls back to the abstract. A one-time load-time
// nudge (not a per-paper Notice) points the user at settings. The richer inline
// settings-tab warning belongs to 008.
function summarizationUnconfiguredNotice(): string {
	return 'PaperGraph3D: Summarization is on but no provider/credential is configured — notes fall back to the original abstract. Check settings.';
}

function reembedDoneNotice(count: number): string {
	return `PaperGraph3D: Re-embedded ${count} paper(s).`;
}

export default class PaperGraph3DPlugin extends Plugin {
	settings!: PluginSettings;
	private scheduler?: SchedulerHandle;
	/** Resolved once the SPECTER2 assets are on disk; undefined keeps papers on the baseline. */
	private modelLocation?: LocalModelLocation;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PaperGraph3DSettingTab(this.app, this));

		// Pick up assets downloaded in a previous session. Never downloads — that
		// requires an explicit install from the settings tab (constitution Principle IV).
		this.modelLocation = await this.resolveModelLocation();

		// The scheduler handle is assigned below, but the store's callbacks (fired only on
		// later user actions) reference it through this closure, so the wiring order is safe.
		let scheduler: SchedulerHandle | undefined;

		const store = createSubscriptionStore({
			// Read-modify-write against the single shared { settings, subscriptions } blob so a
			// subscription save never clobbers sibling settings (research.md Decision 15).
			load: async () => {
				const data = (await this.loadData()) as { subscriptions?: unknown[] } | null;
				const subscriptions = data?.subscriptions;
				return Array.isArray(subscriptions) ? subscriptions : [];
			},
			save: async (subscriptions) => {
				const data = ((await this.loadData()) as Record<string, unknown> | null) ?? {};
				await this.saveData({ ...data, subscriptions });
			},
			onRegistered: (subscription) => {
				void scheduler?.checkNow(subscription);
			},
			onBackfillRequested: (subscription) => {
				void scheduler?.backfillNow(subscription);
			},
			// FR-048: live-read the setting each time (mirrors FR-021's pattern) so a
			// mid-session toggle takes effect immediately, not just on next load.
			isLargeBackfillNoticeEnabled: () => this.settings.backfillLargeWindowNoticeEnabled ?? true,
			onLargeBackfillWindow: (subscription) => {
				new Notice(largeBackfillWindowNotice(subscription));
			},
			onInvalidData: (droppedCount) => {
				new Notice(invalidDataNotice(droppedCount));
			},
		});

		// Ensure persisted subscriptions are loaded before the catch-up pass reads them.
		await store.ready();

		// Persist collected papers through 003's PaperStore over a vault-backed FileStore
		// scoped to the user's storage folder (FR-006). Load the on-disk index up front so
		// dedup (alreadyPersisted) is correct across restarts — a paper saved in a previous
		// session must not be re-persisted on the next collection pass. Store notices reach
		// the user via Obsidian's Notice.
		const paperStore = new PaperStore(
			createObsidianFileStore(this.app, this.settings.storageLocation),
			{ notify: (message) => new Notice(message) },
		);
		await paperStore.load();

		// Converge the persisted corpus on the canonical SPECTER2 space (002 FR-045) —
		// papers collected before the model was downloaded, or whose collection-time
		// upgrade was left pending. Runs in the background, off the load path, touching
		// only off-canonical papers. A no-op until the model is present.
		void this.reembedInBackground(paperStore);

		// 004: warn once at load if summarization is enabled but unconfigured, so the
		// user isn't left wondering why notes still show the raw abstract (FR-006).
		const summarizationProvider = this.settings.summarizationProvider;
		const summarizationCredential = this.settings.summarizationCredential;
		if (
			this.settings.summarizationEnabled &&
			(summarizationProvider === undefined ||
				summarizationProvider.length === 0 ||
				summarizationCredential === undefined ||
				summarizationCredential.trim().length === 0)
		) {
			new Notice(summarizationUnconfiguredNotice());
		}

		const pipelineHooks: PipelineHooks = {
			// 004-owned (FR-006). The stored summarizationProvider id is resolved
			// through the provider registry ('openai' | 'anthropic' | 'gemini'); an
			// unrecognized/absent selection resolves to undefined, which
			// createSummarizeHook() treats as "not configured" (no summarization call
			// is ever attempted). The single summarizationCredential applies to
			// whichever provider is currently selected.
			summarize: createSummarizeHook({
				getProvider: () =>
					resolveSummarizationProvider(this.settings.summarizationProvider),
				getCredential: () => this.settings.summarizationCredential,
				notifyCredentialProblem: (message) => new Notice(message),
				notifyRateLimited: (message) => new Notice(message),
			}),
			persist: (paper, summary) =>
				paperStore.upsert({
					paper,
					summary: summary?.summary,
					futureDirections: summary?.futureDirections,
				}),
			alreadyPersisted: async (sourceId) => paperStore.has(sourceId),
			// When a paper another subscription already persisted is collected again, add
			// this subscription's key to its collectedVia set without re-processing it.
			// mergePaper's union makes the re-persist idempotent even under a race.
			recordCollectedVia: async (sourceId, key) => {
				const stored = await paperStore.get(sourceId);
				if (stored === undefined || stored.collectedVia.includes(key)) {
					return;
				}
				await paperStore.upsert({
					paper: { ...stored, collectedVia: [...stored.collectedVia, key] },
				});
			},
		};

		scheduler = await startScheduler(this, {
			// No subscription-management UI exists yet (owned by 008), so a user cannot
			// intentionally configure a collection plan in-product. Until that ships, perform
			// NO automatic collection — the plugin must not query arXiv/Semantic Scholar on
			// startup or on a timer without a deliberate user action (constitution Principle IV;
			// avoids re-collecting a stray/persisted subscription every launch). 008 removes this.
			autoStart: false,
			getSubscriptions: () => store.list(),
			onSubscriptionChecked: (subscription, checkedThrough, windowFrom) =>
				store.recordChecked(subscription, checkedThrough, windowFrom),
			runCheck: (subscription, window) =>
				runSubscriptionCheck(
					subscription,
					window,
					pipelineHooks,
					// Live getters — read through this.settings at call time (FR-021, Decision 26).
					() => this.settings.summarizationEnabled,
					() => this.settings.semanticScholarApiKey,
					// enrich uses its default (Semantic Scholar batch lookup).
					undefined,
					// Live model location (002 FR-045/FR-046) — undefined until the user
					// has downloaded the model, which keeps papers on the baseline rather
					// than holding them back.
					() => ({ location: this.modelLocation }),
				),
			onFailure: (subscription, reason) => {
				new Notice(subscriptionFailureNotice(subscription, reason));
			},
			onBackfillProgress: (subscription, cursor) =>
				store.recordBackfillProgress(subscription, cursor),
		});
		this.scheduler = scheduler;
	}

	onunload() {
		// The scheduler's recurring tick is registered via registerInterval, so Obsidian
		// clears it automatically on unload — no explicit stop is needed (Principle II).
	}

	private assetPaths() {
		// manifest.dir is typed optional but is always set for a loaded plugin; treat an
		// absent one as "no local model" rather than guessing a path into the vault.
		const dir = this.manifest.dir;
		return dir === undefined ? undefined : assetPaths(dir);
	}

	private async resolveModelLocation(): Promise<LocalModelLocation | undefined> {
		const paths = this.assetPaths();
		if (paths === undefined) {
			return undefined;
		}
		try {
			return await resolveModelLocation(this.app.vault.adapter, paths);
		} catch {
			return undefined;
		}
	}

	private async reembedInBackground(store: PaperStore): Promise<void> {
		if (this.modelLocation === undefined) {
			return;
		}
		try {
			const summary = await reembedCorpus(store, { location: this.modelLocation });
			if (summary.reembedded > 0) {
				new Notice(reembedDoneNotice(summary.reembedded));
			}
		} catch {
			// A converge pass is best-effort; papers keep whatever vector they have.
		}
	}

	/**
	 * Whether every on-device model asset is already on disk. The settings tab reads this
	 * to show installed/not-installed and to disable the install action when present.
	 * Returns false when the plugin folder cannot be located (nothing to install into).
	 */
	async isModelInstalled(): Promise<boolean> {
		const paths = this.assetPaths();
		if (paths === undefined) {
			return false;
		}
		return areAssetsPresent(this.app.vault.adapter, paths);
	}

	/**
	 * Download the on-device embedding model into the plugin folder. Never automatic:
	 * this is ~130 MB fetched from the plugin's GitHub release, its only outbound request
	 * besides paper collection, and it must be the user's decision (constitution
	 * Principle IV) — the settings tab is the sole caller and discloses the size first.
	 *
	 * After a successful download the cached pipeline is dropped and the model location
	 * re-resolved, so the very next embedding uses the model with no reload. Throws on
	 * failure (a missing plugin folder, or a download error, which leaves the folder
	 * clean); the caller keeps the baseline in use and reports the failure.
	 */
	async installModel(onProgress?: (progress: AssetProgress) => void): Promise<void> {
		const paths = this.assetPaths();
		if (paths === undefined) {
			throw new Error('The plugin folder could not be located.');
		}
		await downloadAssets(this.app.vault.adapter, paths, onProgress);
		resetPipeline();
		this.modelLocation = await this.resolveModelLocation();
	}

	async loadSettings() {
		const data = (await this.loadData()) as Record<string, unknown> | null;
		// Migration: before 002, settings were persisted as the whole flat blob
		// (`saveData(this.settings)`), not nested under a `settings` key. When the persisted
		// object has no `settings` key, treat the whole object as the legacy flat settings so
		// a user's configuration isn't silently reset to defaults on first load after
		// upgrading. (Keyed only on `settings` — not `subscriptions` — since the store may
		// persist a `subscriptions` key before settings are ever saved nested; a stray
		// `subscriptions` field is simply ignored by Object.assign as it isn't a
		// PluginSettings field.)
		const persistedSettings: Partial<PluginSettings> | undefined =
			data !== null && 'settings' in data
				? (data.settings as Partial<PluginSettings> | undefined)
				: (data as Partial<PluginSettings> | null) ?? undefined;
		this.settings = Object.assign({}, DEFAULT_PLUGIN_SETTINGS, persistedSettings);
	}

	async saveSettings() {
		const data = ((await this.loadData()) as Record<string, unknown> | null) ?? {};
		await this.saveData({ ...data, settings: this.settings });
	}
}
