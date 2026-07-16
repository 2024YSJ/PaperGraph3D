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
	type LocalModelLocation,
} from './collection/modelAssets';
import { embeddingDiagnostics, resetPipeline } from './collection/localTransformer';
import { EmbeddingDiagnosticsModal, EmbeddingErrorModal } from './ui/diagnosticsModal';
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

// 002 FR-046. The model is fetched once, then every embedding runs on-device and no
// paper data leaves the vault. The size and the network access are stated up front
// rather than discovered (constitution Principle IV).
function modelDownloadStartNotice(): string {
	return (
		'PaperGraph3D: 논문 임베딩 모델(SPECTER2, 약 130MB)을 내려받는 중입니다. 이후에는 완전히 오프라인으로 동작합니다.\n' +
		'Downloading the paper embedding model (SPECTER2, ~130 MB). It runs fully offline afterwards.'
	);
}

function modelDownloadDoneNotice(): string {
	return (
		'PaperGraph3D: 임베딩 모델 준비 완료. 저장된 논문을 배경에서 다시 임베딩합니다.\n' +
		'Embedding model ready. Re-embedding saved papers in the background.'
	);
}

function modelDownloadFailedNotice(reason: string): string {
	return (
		`PaperGraph3D: 임베딩 모델을 내려받지 못했습니다 (${reason}). 기본 임베딩으로 계속 동작하며, 다시 시도할 수 있습니다.\n` +
		`Couldn't download the embedding model (${reason}). The baseline embedding stays in use; you can retry.`
	);
}

function modelAlreadyPresentNotice(): string {
	return (
		'PaperGraph3D: 임베딩 모델이 이미 설치되어 있습니다.\n' +
		'The embedding model is already installed.'
	);
}

function modelUnavailableNotice(): string {
	return (
		'PaperGraph3D: 플러그인 폴더를 찾을 수 없어 모델을 설치할 수 없습니다.\n' +
		"Can't install the model: the plugin folder could not be located."
	);
}

function modelMissingNotice(): string {
	return (
		'PaperGraph3D: 임베딩 모델이 설치되어 있지 않습니다. 먼저 모델을 내려받으세요.\n' +
		'The embedding model is not installed. Download it first.'
	);
}

function diagnosticsRunningNotice(): string {
	return (
		'PaperGraph3D: 임베딩 런타임을 측정하는 중입니다...\n' +
		'Measuring the embedding runtime...'
	);
}

function reembedDoneNotice(count: number): string {
	return (
		`PaperGraph3D: 논문 ${count}편을 다시 임베딩했습니다.\n` +
		`Re-embedded ${count} paper(s).`
	);
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
		// requires the explicit command below (constitution Principle IV).
		this.modelLocation = await this.resolveModelLocation();

		// Command ids are stable once released (AGENTS.md) — this one is the download
		// action itself, not the temporary-UI framing, so 008's settings screen can
		// reuse it rather than renaming it.
		this.addCommand({
			id: 'download-embedding-model',
			// The download size is disclosed in the notice this opens, before anything
			// is fetched — the command name stays sentence case per the Obsidian lint rules.
			name: 'Download paper embedding model for offline use',
			callback: () => {
				void this.downloadModelCommand();
			},
		});

		this.addCommand({
			id: 'diagnose-embedding-runtime',
			name: 'Diagnose embedding runtime',
			callback: () => {
				void this.diagnoseEmbeddingCommand();
			},
		});

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
	 * Measure the embedding runtime and print it to the developer console. Temporary,
	 * for the environment-gated verification T039 has always needed (the runtime's
	 * speed can only be known inside a real Obsidian install).
	 */
	private async diagnoseEmbeddingCommand(): Promise<void> {
		if (this.modelLocation === undefined) {
			new Notice(modelMissingNotice());
			return;
		}
		const notice = new Notice(diagnosticsRunningNotice(), 0);
		const location = this.modelLocation;
		try {
			const diagnostics = await embeddingDiagnostics(location);
			notice.hide();
			new EmbeddingDiagnosticsModal(this.app, diagnostics).open();
		} catch (error) {
			notice.hide();
			// The resolved URLs are half the diagnosis: if they are malformed, or point
			// somewhere other than the plugin folder, the failure is ours and not the
			// runtime's.
			const context = `modelsBaseUrl: ${location.modelsBaseUrl}`;
			new EmbeddingErrorModal(this.app, error, context).open();
		}
	}

	/**
	 * Download the on-device embedding model. Explicit command, never automatic: this
	 * is ~130 MB fetched from Hugging Face and jsDelivr, the plugin's only outbound
	 * request besides paper collection, and it must be the user's decision
	 * (constitution Principle IV). A temporary entry point until 008's settings UI.
	 */
	private async downloadModelCommand(): Promise<void> {
		const paths = this.assetPaths();
		if (paths === undefined) {
			new Notice(modelUnavailableNotice());
			return;
		}
		if (await areAssetsPresent(this.app.vault.adapter, paths)) {
			new Notice(modelAlreadyPresentNotice());
			return;
		}

		const notice = new Notice(modelDownloadStartNotice(), 0);
		try {
			await downloadAssets(this.app.vault.adapter, paths, (progress) => {
				notice.setMessage(
					`PaperGraph3D: 임베딩 모델 다운로드 중 (${progress.fileIndex}/${progress.fileCount}) ${progress.fileName}\n` +
						`Downloading embedding model (${progress.fileIndex}/${progress.fileCount}) ${progress.fileName}`,
				);
			});
			resetPipeline();
			this.modelLocation = await this.resolveModelLocation();
			notice.hide();
			new Notice(modelDownloadDoneNotice());
		} catch (error) {
			notice.hide();
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(modelDownloadFailedNotice(reason));
		}
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
