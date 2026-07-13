import { App, Modal, Notice, Plugin, Setting } from 'obsidian';
import type { PipelineHooks } from '../collection/types';
import type { EmbeddingConfig } from '../collection/embeddingUpgrade';
import { runSubscriptionCheck } from '../collection/pipeline';

// Interim manual-collection command. Until the 008 subscription-management UI ships there is
// no in-product way to trigger collection, so this exposes a single deliberate user action
// (constitution Principle IV: a manual command, never automatic) that runs one 002 collection
// pass for a keyword over a recent window and persists through the same 003 hooks the
// scheduler uses. Delegated out of main.ts (lifecycle-only) per AGENTS.md.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEYWORD = 'transformer';
const DEFAULT_DAYS = 7;

// Bilingual notices (constitution Principle V: Korean first, English second). Kept as helper
// functions — like main.ts's notice copy — so the message assembly lives in one place.
function collectingNotice(keyword: string, days: number): string {
	return `PaperGraph3D: "${keyword}" 최근 ${days}일 수집 중…\nCollecting "${keyword}" (last ${days} days)…`;
}
function collectedNotice(keyword: string): string {
	return `PaperGraph3D: "${keyword}" 수집 완료.\nCollection of "${keyword}" done.`;
}
function collectFailedNotice(message: string): string {
	return `PaperGraph3D: 수집 실패 — ${message}\nCollection failed — ${message}`;
}
function emptyKeywordNotice(): string {
	return 'PaperGraph3D: 키워드를 입력하세요.\nEnter a keyword.';
}

export interface CollectPapersDeps {
	hooks: PipelineHooks;
	isSummarizationEnabled: () => boolean;
	getSemanticScholarApiKey: () => string | undefined;
	getEmbeddingConfig: () => EmbeddingConfig;
}

// Small keyword/window prompt so the user chooses what to collect (a real action, not a
// hardcoded query).
class CollectModal extends Modal {
	private keyword = DEFAULT_KEYWORD;
	private days = DEFAULT_DAYS;

	constructor(
		app: App,
		private readonly onSubmit: (keyword: string, days: number) => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		this.setTitle('논문 수집 / Collect papers');

		new Setting(contentEl).setName('키워드 / Keyword').addText((text) =>
			text.setValue(this.keyword).onChange((value) => {
				this.keyword = value;
			}),
		);

		new Setting(contentEl).setName('최근 일수 / Days back').addText((text) =>
			text.setValue(String(this.days)).onChange((value) => {
				const parsed = Number(value);
				if (Number.isFinite(parsed) && parsed > 0) {
					this.days = Math.floor(parsed);
				}
			}),
		);

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('수집 / Collect')
				.setCta()
				.onClick(() => {
					this.close();
					this.onSubmit(this.keyword.trim(), this.days);
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export function registerCollectPapersCommand(plugin: Plugin, deps: CollectPapersDeps): void {
	async function collect(keyword: string, days: number): Promise<void> {
		if (keyword.length === 0) {
			new Notice(emptyKeywordNotice());
			return;
		}
		const to = Date.now();
		const from = to - days * DAY_MS;
		new Notice(collectingNotice(keyword, days));
		try {
			await runSubscriptionCheck(
				{ type: 'keyword', value: keyword },
				{ from, to },
				deps.hooks,
				deps.isSummarizationEnabled,
				deps.getSemanticScholarApiKey,
				// enrich uses its default (Semantic Scholar batch lookup).
				undefined,
				deps.getEmbeddingConfig,
			);
			new Notice(collectedNotice(keyword));
		} catch (error) {
			new Notice(collectFailedNotice(error instanceof Error ? error.message : String(error)));
		}
	}

	plugin.addCommand({
		id: 'collect-recent-papers',
		name: 'Collect recent papers by keyword',
		callback: () => {
			new CollectModal(plugin.app, (keyword, days) => {
				void collect(keyword, days);
			}).open();
		},
	});
}
