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
			onInvalidData: (droppedCount) => {
				new Notice(invalidDataNotice(droppedCount));
			},
		});

		// Ensure persisted subscriptions are loaded before the catch-up pass reads them.
		await store.ready();

		// Pipeline hooks are stubs until 003 (persistence) / 004 (summarization) ship. The
		// summarize hook is intentionally omitted (undefined) until 004 exists.
		const pipelineHooks: PipelineHooks = {
			persist: async () => {},
			alreadyPersisted: async () => false,
		};

		scheduler = await startScheduler(this, {
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
