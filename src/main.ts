import { Plugin } from 'obsidian';
import {
	PluginSettings,
	DEFAULT_PLUGIN_SETTINGS,
	PaperGraph3DSettingTab,
} from './settings';

export default class PaperGraph3DPlugin extends Plugin {
	settings!: PluginSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new PaperGraph3DSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_PLUGIN_SETTINGS,
			(await this.loadData()) as Partial<PluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
