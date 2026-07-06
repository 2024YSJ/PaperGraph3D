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
	// Concrete, non-empty default so the plugin is usable with no setup (FR-011).
	storageLocation: 'PaperGraph3D',
	// Off until explicit opt-in, per constitution Principle IV (FR-012).
	summarizationEnabled: false,
	// Placeholder defaults, not committed decisions: the future graph-display
	// feature (007) may refine or replace these (FR-013, FR-016).
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
