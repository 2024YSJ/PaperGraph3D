import { App, Notice, PluginSettingTab, Setting, type ButtonComponent } from 'obsidian';
import PaperGraph3DPlugin from './main';
import { PluginSettings, DEFAULT_PLUGIN_SETTINGS } from './models/settings';
import type { AssetProgress } from './collection/modelAssets';

export type { PluginSettings };
export { DEFAULT_PLUGIN_SETTINGS };

// User-facing copy is English-only (per project decision). Kept in helper functions so
// the strings are not literal arguments to the Setting/Notice APIs, matching how main.ts
// writes its notices.
function modelSectionHeading(): string {
	return 'Embedding model';
}

function modelInstalledName(): string {
	return 'Model installed';
}

function modelNotInstalledName(): string {
	return 'Model not installed';
}

function modelInstalledDesc(): string {
	return 'Paper embedding runs fully on-device and offline.';
}

function modelNotInstalledDesc(): string {
	return (
		'A one-time ~130 MB download; offline thereafter. ' +
		'The baseline embedding is used until it is installed.'
	);
}

function installButtonLabel(): string {
	return 'Install';
}

function installedButtonLabel(): string {
	return 'Installed';
}

function installStartNotice(): string {
	return (
		'PaperGraph3D: Downloading the paper embedding model (SPECTER2, ~130 MB). ' +
		'It runs fully offline afterwards.'
	);
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

	constructor(app: App, plugin: PaperGraph3DPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName(modelSectionHeading()).setHeading();

		// The installed-state check is async, so render into a dedicated container that
		// renderModelSection() can rebuild in place once it resolves and after an install.
		const modelSection = containerEl.createDiv();
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
					// FR-046 (Principle IV): once present, the download must not run again —
					// the button is shown, disabled, so the state is legible rather than absent.
					// buttonEl.disabled (plain DOM) rather than ButtonComponent.setDisabled,
					// which needs a newer Obsidian than the manifest's minAppVersion.
					button.setButtonText(installedButtonLabel());
					button.buttonEl.disabled = true;
					return;
				}
				button
					.setButtonText(installButtonLabel())
					.setCta()
					.onClick(() => {
						void this.runInstall(section, button);
					});
			});
	}

	private async runInstall(section: HTMLElement, button: ButtonComponent): Promise<void> {
		// Guard the button immediately so a double-click cannot start two downloads.
		button.buttonEl.disabled = true;
		const notice = new Notice(installStartNotice(), 0);
		try {
			await this.plugin.installModel((progress) => {
				notice.setMessage(installProgressMessage(progress));
			});
			notice.hide();
			new Notice(installDoneNotice());
			// Re-render: the section now reports installed and the button is disabled.
			await this.renderModelSection(section);
		} catch (error) {
			notice.hide();
			const reason = error instanceof Error ? error.message : String(error);
			new Notice(installFailedNotice(reason));
			button.buttonEl.disabled = false;
		}
		// 002 FR-048: toggle for the large-backfill-window informational Notice. Off by
		// user choice only suppresses the Notice — the backfill itself is unaffected.
		// The rest of the four-section settings screen is 008's scope.
		new Setting(containerEl)
			.setName('백필 대량 안내 (backfill large-window notice)')
			.setDesc(
				'백필 범위가 넓을 때 안내 문구를 표시합니다. Show an informational notice when a requested backfill window spans a long period.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.backfillLargeWindowNoticeEnabled ?? true)
					.onChange(async (value) => {
						this.plugin.settings.backfillLargeWindowNoticeEnabled = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
