import { App, PluginSettingTab, Setting } from 'obsidian';
import PaperGraph3DPlugin from './main';
import { PluginSettings, DEFAULT_PLUGIN_SETTINGS } from './models/settings';

export type { PluginSettings };
export { DEFAULT_PLUGIN_SETTINGS };

export class PaperGraph3DSettingTab extends PluginSettingTab {
	plugin: PaperGraph3DPlugin;

	constructor(app: App, plugin: PaperGraph3DPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

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
