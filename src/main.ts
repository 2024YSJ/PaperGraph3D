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
import { createObsidianFileStore } from './persistence/filestore-obsidian';
import { PaperStore } from './persistence/store';
import { createSummarizeHook } from './services/summarization/hook';
import { resolveSummarizationProvider } from './services/summarization/providers/registry';

// Bilingual-ready user-facing copy (constitution Principle V). Korean first, English second.
function subscriptionFailureNotice(
	subscription: Subscription,
	reason: 'unreachable' | 'truncated',
): string {
	const label = subscription.label;
	if (reason === 'unreachable') {
		return (
			`PaperGraph3D: "${label}" 구독을 확인할 수 없습니다 (제공자에 연결하지 못함). 다음에 다시 시도합니다.\n` +
			`Couldn't check subscription "${label}" (provider unreachable). Will retry.`
		);
	}
	return (
		`PaperGraph3D: "${label}" 검색 범위가 너무 커서 한 번에 모두 다루지 못했습니다. 나머지는 다음 확인에서 이어집니다.\n` +
		`Search window for "${label}" was too large to cover at once; the rest continues on the next check.`
	);
}

function invalidDataNotice(droppedCount: number): string {
	return (
		`PaperGraph3D: 저장된 구독 ${droppedCount}개가 손상되어 무시되었습니다.\n` +
		`${droppedCount} stored subscription(s) were corrupted and have been ignored.`
	);
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
	return (
		'PaperGraph3D: 요약이 켜져 있지만 제공자 또는 자격 증명이 설정되지 않아 원문 초록으로 대체됩니다. 설정에서 확인하세요.\n' +
		'Summarization is on but no provider/credential is configured — notes fall back to the original abstract. Check settings.'
	);
}

export default class PaperGraph3DPlugin extends Plugin {
	settings!: PluginSettings;
	private scheduler?: SchedulerHandle;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PaperGraph3DSettingTab(this.app, this));

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

		// Converge the persisted corpus on the currently-selected canonical embedding
		// space (001 FR-022 / 002 FR-045) — e.g. after the user switched embedding
		// provider, or a collection-time upgrade was left pending. Runs in the
		// background, off the load path, touching only off-canonical papers.
		void reembedCorpus(paperStore, {
			provider: this.settings.embeddingProvider ?? 'bundled',
			localModel: this.settings.localEmbeddingModel,
			credential: this.settings.embeddingCredential,
		}).catch(() => undefined);

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
					// Live embedding-provider selection (001 FR-022 / 002 FR-045/FR-046).
					() => ({
						provider: this.settings.embeddingProvider ?? 'bundled',
						localModel: this.settings.localEmbeddingModel,
						credential: this.settings.embeddingCredential,
					}),
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
