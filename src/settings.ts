import { App, Notice, PluginSettingTab, Setting, type ButtonComponent } from 'obsidian';
import PaperGraph3DPlugin from './main';
import { PluginSettings, DEFAULT_PLUGIN_SETTINGS } from './models/settings';
import {
	ALLOWED_CHECK_INTERVALS_HOURS,
	type SubscriptionType,
} from './models/subscription';
import { SUMMARIZATION_PROVIDER_IDS } from './services/summarization/providers/registry';
import type { AssetProgress } from './collection/modelAssets';

export type { PluginSettings };
export { DEFAULT_PLUGIN_SETTINGS };

const DAY_MS = 24 * 60 * 60 * 1000;

// User-facing copy is English-only (constitution v2.0.0). The 008 settings screen only
// PLACES controls and delegates every behavior to the owning feature (002–007); it holds
// no product logic of its own.

// ── model-install copy (004/002; the on-device SPECTER2 download) ────────────────────
function modelInstalledName(): string {
	return 'Embedding model installed';
}
function modelNotInstalledName(): string {
	return 'Embedding model not installed';
}
function modelInstalledDesc(): string {
	return 'Paper embedding runs fully on-device and offline.';
}
function modelNotInstalledDesc(): string {
	return 'A one-time ~130 MB download, offline thereafter. The baseline embedding is used until it is installed; non-embedded papers show in red on the graph.';
}
function installStartNotice(): string {
	return 'PaperGraph3D: Downloading the paper embedding model (SPECTER2, ~130 MB). It runs fully offline afterwards.';
}
function installProgressMessage(progress: AssetProgress): string {
	return `PaperGraph3D: Downloading embedding model (${progress.fileIndex}/${progress.fileCount}) ${progress.fileName}`;
}
function installDoneNotice(): string {
	return 'PaperGraph3D: Embedding model ready. Saved papers are re-embedded in the background.';
}
function installFailedNotice(reason: string): string {
	return `PaperGraph3D: Couldn't download the embedding model (${reason}). The baseline embedding stays in use; you can retry.`;
}

export class PaperGraph3DSettingTab extends PluginSettingTab {
	plugin: PaperGraph3DPlugin;
	// Local state for the "add subscription" form.
	private newType: SubscriptionType = 'arxivCategory';
	private newValue = '';

	constructor(app: App, plugin: PaperGraph3DPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private get settings(): PluginSettings {
		return this.plugin.settings;
	}

	private save(): Promise<void> {
		return this.plugin.saveSettings();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		this.renderSubscriptions(containerEl);
		this.renderStorage(containerEl);
		this.renderSummarization(containerEl);
		this.renderGraphDisplay(containerEl);
	}

	// ── Section 1: subscriptions & collection (002) ──────────────────────────────────
	private renderSubscriptions(root: HTMLElement): void {
		new Setting(root).setName('Subscriptions & collection').setHeading();

		new Setting(root)
			.setName('Automatic collection')
			.setDesc(
				'When on, checks each enabled subscription on load and every 15 minutes. Off by default — the plugin never queries the network on startup or a timer without this. Takes effect on the next reload.',
			)
			.addToggle((t) =>
				t.setValue(this.settings.autoCollectionEnabled ?? false).onChange(async (v) => {
					this.settings.autoCollectionEnabled = v;
					await this.save();
				}),
			);

		new Setting(root)
			.setName('Semantic Scholar API key (optional)')
			.setDesc(
				'Grants a dedicated rate limit for citation enrichment. Optional — enrichment works without it. Sent only to api.semanticscholar.org; stored unencrypted in the vault plugin data. arXiv needs no key.',
			)
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setValue(this.settings.semanticScholarApiKey ?? '').onChange(async (v) => {
					this.settings.semanticScholarApiKey = v.trim() === '' ? undefined : v.trim();
					await this.save();
				});
			});

		new Setting(root)
			.setName('Warn on large backfill windows')
			.setDesc('Show a notice when a backfill spans a long period. Does not change the backfill itself.')
			.addToggle((t) =>
				t.setValue(this.settings.backfillLargeWindowNoticeEnabled ?? true).onChange(async (v) => {
					this.settings.backfillLargeWindowNoticeEnabled = v;
					await this.save();
				}),
			);

		const listEl = root.createDiv();
		this.renderSubscriptionList(listEl);

		new Setting(root)
			.setName('Add a subscription')
			.setDesc('Track a keyword, an author, or an arXiv category.')
			.addDropdown((d) =>
				d
					.addOption('arxivCategory', 'arXiv category')
					.addOption('keyword', 'Keyword')
					.addOption('author', 'Author')
					.setValue(this.newType)
					.onChange((v) => (this.newType = v as SubscriptionType)),
			)
			.addText((t) =>
				t.setPlaceholder('value (e.g. cs.LG)').setValue(this.newValue).onChange((v) => (this.newValue = v)),
			)
			.addButton((b) =>
				b
					.setButtonText('Add')
					.setCta()
					.onClick(async () => {
						const store = this.plugin.subscriptionStore;
						if (store === undefined) {
							new Notice('Plugin is still loading — try again in a moment.');
							return;
						}
						if (this.newValue.trim() === '') {
							new Notice('Enter a value for the subscription.');
							return;
						}
						await store.register({ type: this.newType, value: this.newValue.trim() });
						this.newValue = '';
						this.display(); // rebuild so the list and the cleared form both refresh
					}),
			);
	}

	private renderSubscriptionList(listEl: HTMLElement): void {
		listEl.empty();
		const store = this.plugin.subscriptionStore;
		const subs = store !== undefined ? store.list() : [];
		if (subs.length === 0) {
			const empty = listEl.createEl('div', { text: 'No subscriptions yet.' });
			empty.style.color = 'var(--text-muted)';
			empty.style.margin = '4px 0 8px';
			return;
		}
		for (const sub of subs) {
			// Row 1: identity + enabled toggle + interval + collect-now + remove.
			new Setting(listEl)
				.setName(sub.label)
				.setDesc(`${sub.type}: ${sub.value}`)
				.addToggle((t) =>
					t
						.setTooltip('Enabled')
						.setValue(sub.enabled)
						.onChange(async (v) => {
							await store?.setEnabled(sub, v);
						}),
				)
				.addDropdown((d) => {
					for (const h of ALLOWED_CHECK_INTERVALS_HOURS) {
						d.addOption(String(h), `${h}h`);
					}
					d.setValue(String(sub.checkIntervalHours)).onChange(async (v) => {
						await store?.setCheckInterval(sub, Number(v));
					});
				})
				.addExtraButton((b) =>
					b
						.setIcon('download')
						.setTooltip('Collect now')
						.onClick(() => void this.plugin.collectNow(sub)),
				)
				.addExtraButton((b) =>
					b
						.setIcon('trash')
						.setTooltip('Remove')
						.onClick(async () => {
							await store?.remove(sub);
							this.renderSubscriptionList(listEl);
						}),
				);

			// Row 2: backfill older papers from a chosen date.
			let backfillDate = new Date(Date.now() - 365 * DAY_MS).toISOString().slice(0, 10);
			const bfRow = new Setting(listEl).setDesc(
				'Backfill older papers from this date. Run "Collect now" at least once first, so there is a coverage point to fill below.',
			);
			bfRow.addText((t) => {
				t.inputEl.type = 'date';
				t.setValue(backfillDate).onChange((v) => (backfillDate = v));
			});
			bfRow.addButton((b) =>
				b.setButtonText('Backfill').onClick(async () => {
					const ms = Date.parse(`${backfillDate}T00:00:00Z`);
					if (!Number.isFinite(ms)) {
						new Notice('Pick a valid date.');
						return;
					}
					if (ms > Date.now()) {
						new Notice('Backfill date must be in the past.');
						return;
					}
					try {
						await store?.requestBackfill(sub, ms);
						new Notice(`PaperGraph3D: Backfill requested for "${sub.label}" from ${backfillDate}.`);
						this.renderSubscriptionList(listEl);
					} catch (error) {
						new Notice(
							`PaperGraph3D: Couldn't start backfill: ${error instanceof Error ? error.message : String(error)}`,
						);
					}
				}),
			);
			if (sub.backfillState !== undefined && sub.backfillState !== null) {
				bfRow.addExtraButton((b) =>
					b
						.setIcon('x')
						.setTooltip('Cancel backfill')
						.onClick(async () => {
							await store?.cancelBackfill(sub);
							this.renderSubscriptionList(listEl);
						}),
				);
			}
		}
	}

	// ── Section 2: storage location (003) ────────────────────────────────────────────
	private renderStorage(root: HTMLElement): void {
		new Setting(root).setName('Storage location').setHeading();
		new Setting(root)
			.setName('Vault folder')
			.setDesc('Folder where paper records (.json) and notes (.md) are written.')
			.addText((t) =>
				t.setValue(this.settings.storageLocation).onChange(async (v) => {
					const trimmed = v.trim();
					if (trimmed.length > 0) {
						this.settings.storageLocation = trimmed;
						await this.save();
					}
				}),
			);
	}

	// ── Section 3: summarization + on-device model (004/002) ─────────────────────────
	private renderSummarization(root: HTMLElement): void {
		new Setting(root).setName('Summarization & embedding model').setHeading();

		new Setting(root)
			.setName('Enable summarization')
			.setDesc(
				'Generate an abstract-based summary and future-directions for each collected paper. Off by default (opt-in). Requires a provider and API key below.',
			)
			.addToggle((t) =>
				t.setValue(this.settings.summarizationEnabled).onChange(async (v) => {
					this.settings.summarizationEnabled = v;
					await this.save();
				}),
			);

		new Setting(root)
			.setName('Summarization provider')
			.setDesc('Which LLM generates summaries.')
			.addDropdown((d) => {
				d.addOption('', '(none)');
				for (const id of SUMMARIZATION_PROVIDER_IDS) {
					d.addOption(id, id);
				}
				d.setValue(this.settings.summarizationProvider ?? '').onChange(async (v) => {
					this.settings.summarizationProvider = v === '' ? undefined : v;
					await this.save();
				});
			});

		new Setting(root)
			.setName('LLM API key')
			.setDesc(
				'Sent to the selected summarization provider. Stored unencrypted in the vault plugin data. The plugin works fully without summarization.',
			)
			.addText((t) => {
				t.inputEl.type = 'password';
				t.setValue(this.settings.summarizationCredential ?? '').onChange(async (v) => {
					this.settings.summarizationCredential = v.trim() === '' ? undefined : v;
					await this.save();
				});
			});

		// The on-device SPECTER2 model download (async install-state check → own container).
		const modelSection = root.createDiv();
		void this.renderModelSection(modelSection);
	}

	private async renderModelSection(section: HTMLElement): Promise<void> {
		section.empty();
		const installed = await this.plugin.isModelInstalled();
		new Setting(section)
			.setName(installed ? modelInstalledName() : modelNotInstalledName())
			.setDesc(installed ? modelInstalledDesc() : modelNotInstalledDesc())
			.addButton((button) => {
				if (installed) {
					button.setButtonText('Installed');
					button.buttonEl.disabled = true;
					return;
				}
				button
					.setButtonText('Install')
					.setCta()
					.onClick(() => void this.runInstall(section, button));
			});
	}

	private async runInstall(section: HTMLElement, button: ButtonComponent): Promise<void> {
		button.buttonEl.disabled = true;
		const notice = new Notice(installStartNotice(), 0);
		try {
			await this.plugin.installModel((progress) => notice.setMessage(installProgressMessage(progress)));
			notice.hide();
			new Notice(installDoneNotice());
			await this.renderModelSection(section);
		} catch (error) {
			notice.hide();
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(installFailedNotice(reason));
			button.buttonEl.disabled = false;
		}
	}

	// ── Section 4: graph display (007) — render window only ──────────────────────────
	private renderGraphDisplay(root: HTMLElement): void {
		new Setting(root).setName('Graph display').setHeading();
		new Setting(root)
			.setName('Render window')
			.setDesc(
				'How much of the corpus the 3D graph loads by default, so a session never materializes everything. Node color and layout are fixed and not configurable.',
			)
			.addDropdown((d) => {
				d.addOption('1', 'Last 1 year');
				d.addOption('2', 'Last 2 years');
				d.addOption('5', 'Last 5 years');
				d.addOption('0', 'All papers');
				d.setValue(String(this.settings.renderWindowYears ?? 1)).onChange(async (v) => {
					this.settings.renderWindowYears = Number(v);
					await this.save();
				});
			});
	}
}
