export interface GraphDisplayOptions {
	layout: string;
	colorScheme: string;
}

export interface PluginSettings {
	storageLocation: string;
	summarizationEnabled: boolean;
	graphDisplayOptions: GraphDisplayOptions;
}

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
	storageLocation: 'PaperGraph3D',
	summarizationEnabled: false,
	graphDisplayOptions: {
		layout: 'force-directed',
		colorScheme: 'byPublicationYear',
	},
};

function isValidGraphDisplayOptions(value: unknown): value is GraphDisplayOptions {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.layout === 'string' && typeof candidate.colorScheme === 'string';
}

export function isValidPluginSettings(data: unknown): data is PluginSettings {
	if (typeof data !== 'object' || data === null) {
		return false;
	}

	const candidate = data as Record<string, unknown>;

	return (
		typeof candidate.storageLocation === 'string' &&
		candidate.storageLocation.length > 0 &&
		typeof candidate.summarizationEnabled === 'boolean' &&
		isValidGraphDisplayOptions(candidate.graphDisplayOptions)
	);
}
