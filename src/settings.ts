import { App, PluginSettingTab } from 'obsidian';
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
	}
}
