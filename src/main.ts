import { Notice, Plugin } from 'obsidian';
import {
	PluginSettings,
	DEFAULT_PLUGIN_SETTINGS,
	PaperGraph3DSettingTab,
} from './settings';
import type { EmbeddingFailure } from './models/paper';
import type { Subscription } from './models/subscription';
import { createSubscriptionStore, type SubscriptionStore } from './collection/subscriptionStore';
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
import { describeOutcome, verifyEmbeddingRuntime } from './commands/verifyEmbeddingRuntime';
import { describeCoverage, measureEmbeddingCoverage } from './commands/embeddingCoverage';
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

// The embedding runtime failed part-way through. Papers are still collected and
// readable — only their canonical vector is missing — so this reports the shortfall
// and what to do, rather than presenting itself as a collection failure. Naming the
// out-of-memory case specifically matters: restarting Obsidian actually fixes it,
// whereas nothing the user does in-app will fix a broken install.
function notReadyNotice(): string {
	return 'PaperGraph3D: Still loading — try again in a moment.';
}

function noSubscriptionsNotice(): string {
	return 'PaperGraph3D: No enabled subscriptions to collect from.';
}

function collectingNotice(done: number, total: number, label?: string): string {
	const which = label === undefined ? '' : ` — ${label}`;
	return `PaperGraph3D: Collecting ${done}/${total}${which}`;
}

function collectionDoneNotice(checked: number, total: number): string {
	return `PaperGraph3D: Collection finished (${checked}/${total} subscription(s) checked).`;
}

function modelNotInstalledNotice(): string {
	return 'PaperGraph3D: The embedding model is not installed — install it from settings first.';
}

function verifyingRuntimeNotice(): string {
	return 'PaperGraph3D: Verifying embedding runtime…';
}

function verifyProgressNotice(completed: number, total: number, residentMb: number | undefined): string {
	const memory = residentMb === undefined ? '' : ` (${residentMb} MB)`;
	return `PaperGraph3D: Verifying embedding runtime — ${completed}/${total}${memory}`;
}

function verifyFailedToRunNotice(detail: string): string {
	return `PaperGraph3D: Embedding verification could not run — ${detail}`;
}

function embeddingFailedNotice(failure: EmbeddingFailure, affected: number): string {
	const scope = `${affected} paper(s) were saved without a graph embedding`;
	if (failure.reason === 'out-of-memory') {
		return `PaperGraph3D: The on-device embedding model ran out of memory — ${scope}. Restart Obsidian, then run the re-embed to finish them.`;
	}
	return `PaperGraph3D: The on-device embedding model failed (${failure.detail}) — ${scope}.`;
}

export default class PaperGraph3DPlugin extends Plugin {
	settings!: PluginSettings;
	private scheduler?: SchedulerHandle;
	/** Resolved once the SPECTER2 assets are on disk; undefined keeps papers on the baseline. */
	private modelLocation?: LocalModelLocation;
	/** Held so the collect/coverage commands can reach them; 008 owns the real UI. */
	private subscriptions?: SubscriptionStore;
	private papers?: PaperStore;

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
		this.subscriptions = store;

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
		this.papers = paperStore;

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
			onEmbeddingFailed: (failure, affected) => {
				new Notice(embeddingFailedNotice(failure, affected), 0);
			},
		};

		// Local, offline check that the embedding runtime survives a corpus-sized run.
		// The failure it looks for only reproduces inside Obsidian against the real
		// onnxruntime build, so it cannot live in the offline suites. Explicit command,
		// never automatic: it is minutes of CPU and the user must choose to spend it.
		this.addCommand({
			id: 'verify-embedding-runtime',
			name: 'Verify embedding runtime',
			callback: () => {
				void this.runEmbeddingVerification();
			},
		});

		// Run the configured subscriptions once, now. The scheduler ships with
		// autoStart: false because no subscription-management UI exists yet, so without
		// this the only way to collect is from the developer console. This is a trigger,
		// not subscription management — configuring subscriptions remains 008's.
		this.addCommand({
			id: 'collect-papers-now',
			name: 'Collect papers now',
			callback: () => {
				void this.runCollectionNow();
			},
		});

		// How much of the corpus the graph can actually place. Reads the store only.
		this.addCommand({
			id: 'report-embedding-coverage',
			name: 'Report embedding coverage',
			callback: () => {
				void this.reportEmbeddingCoverage();
			},
		});

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

	/**
	 * Check every enabled subscription once, sequentially, then report how much of the
	 * corpus ended up in the graph's embedding space. Sequential because each check is
	 * already a paced arXiv + Semantic Scholar conversation; running them concurrently
	 * would only pull rate limits forward.
	 */
	private async runCollectionNow(): Promise<void> {
		const subscriptions = this.subscriptions;
		const scheduler = this.scheduler;
		if (subscriptions === undefined || scheduler === undefined) {
			new Notice(notReadyNotice());
			return;
		}

		const enabled = subscriptions.list().filter((subscription) => subscription.enabled);
		if (enabled.length === 0) {
			new Notice(noSubscriptionsNotice());
			return;
		}

		const progress = new Notice(collectingNotice(0, enabled.length), 0);
		let checked = 0;
		try {
			for (const subscription of enabled) {
				progress.setMessage(collectingNotice(checked, enabled.length, subscription.label));
				// One subscription failing is already surfaced by the scheduler's own
				// onFailure notice; keep going so a single bad query cannot strand the rest.
				await scheduler.checkNow(subscription);
				checked += 1;
			}
		} finally {
			progress.hide();
		}

		new Notice(collectionDoneNotice(checked, enabled.length), 0);
		await this.reportEmbeddingCoverage();
	}

	/** Report how much of the persisted corpus sits in the canonical embedding space. */
	private async reportEmbeddingCoverage(): Promise<void> {
		const papers = this.papers;
		if (papers === undefined) {
			new Notice(notReadyNotice());
			return;
		}
		const report = await measureEmbeddingCoverage(papers);
		// The counts are worth keeping past the Notice whenever the corpus is not fully
		// canonical — that is the state someone will want to look at again.
		if (report.canonical !== report.total) {
			console.error('[PaperGraph3D] Embedding coverage', report);
		}
		new Notice(`PaperGraph3D: ${describeCoverage(report)}`, 0);
	}

	/**
	 * Drive the embedding runtime over a corpus-sized batch of varying-length inputs and
	 * report where it stands. Progress goes to a persistent Notice (a run is minutes) and
	 * the full outcome to the console, so a failure can be read after the Notice is gone.
	 */
	private async runEmbeddingVerification(): Promise<void> {
		const location = this.modelLocation;
		if (location === undefined) {
			new Notice(modelNotInstalledNotice());
			return;
		}

		const progress = new Notice(verifyingRuntimeNotice(), 0);
		try {
			const outcome = await verifyEmbeddingRuntime(location, (p) => {
				progress.setMessage(verifyProgressNotice(p.completed, p.total, p.residentMb));
			});
			progress.hide();
			// A run that dies is the finding this command exists to produce, so the
			// structured outcome goes to the console where it survives the Notice being
			// dismissed. A clean run needs no such record — the Notice says it all.
			if (outcome.failedAt !== undefined) {
				console.error('[PaperGraph3D] Embedding verification failed', outcome);
			}
			new Notice(`PaperGraph3D: ${describeOutcome(outcome)}`, 0);
		} catch (error) {
			progress.hide();
			console.error('[PaperGraph3D] Embedding verification could not run', error);
			new Notice(
				verifyFailedToRunNotice(error instanceof Error ? error.message : String(error)),
				0,
			);
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
			// A converge pass that gave up is the ONLY signal that the corpus has papers
			// the graph cannot place. It used to be counted and thrown away — only
			// `reembedded > 0` was ever reported — so a pass that converged nothing
			// because the runtime was dead looked exactly like a pass with nothing to do.
			if (summary.failure !== undefined) {
				new Notice(embeddingFailedNotice(summary.failure, summary.failed), 0);
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
		await resetPipeline();
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
