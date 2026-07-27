export interface GraphDisplayOptions {
	  layout: string;
	  colorScheme: string;
}

// There is no embedding-provider setting (001 FR-022 superseded). The canonical
// embedding space is fixed to on-device SPECTER2: only vectors sharing one space can
// be projected together by the graph feature (001 FR-020), so a user-chosen provider
// was really a user-chosen dimensionality, and the corpus could not survive the
// choice. See src/collection/localTransformer.ts.
export interface PluginSettings {
	  storageLocation: string;
	  summarizationEnabled: boolean;
	  graphDisplayOptions: GraphDisplayOptions;
	  // Optional, absent by default (FR-020, an FR-016-style additive extension by the
  // 002 collection feature — no existing 001 field is removed or redefined, and
  // DEFAULT_PLUGIN_SETTINGS is left unchanged since the field is optional). Read by
  // src/collection/semanticScholarClient.ts, which sends it as an `x-api-key` header
  // when present and omits it entirely when undefined. Never required — enrichment
  // works without it against Semantic Scholar's shared unauthenticated pool; a key
  // only grants a dedicated rate limit.
  semanticScholarApiKey?: string;
	  // Whether a large-backfill-window informational Notice (002 FR-048) is shown when
  // a user requests a backfill spanning more than the large-window threshold. An
  // optional, FR-016-style additive extension: absent means on (the default), so
  // existing persisted settings without this field keep seeing the Notice. Turning
  // it off only suppresses the Notice; the backfill itself is never gated or
  // altered by this setting.
  backfillLargeWindowNoticeEnabled?: boolean;
	  // 004-owned (FR-006). Which SummarizationProvider.id to use for text
  // generation. Absent/undefined -> no summarization call is possible even if
  // summarizationEnabled is true (treated as "not configured", FR-008-style
  // credential-problem messaging).
  summarizationProvider?: string;
	  // 004-owned (FR-006). Plaintext credential for the summarization provider
  // (constitution Principle IV — disclosed in settings UI copy).
  summarizationCredential?: string;
	  // 008/002-owned. Global automatic-collection switch (the scheduler's `autoStart`).
  // Absent/false means NO automatic collection — no catch-up-on-load, no recurring
  // tick — so the plugin never touches the network on startup/timer without a
  // deliberate opt-in (constitution Principle IV). Manual checks still work.
  autoCollectionEnabled?: boolean;
	  // 007/008-owned (007 FR-021). The default render window: how many trailing years of
  // papers the graph loads by default. 0 means "all papers"; absent means the default
  // (1 year). Bounds load/projection cost so a session never materializes the whole
  // corpus.
  renderWindowYears?: number;
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
	      isValidGraphDisplayOptions(candidate.graphDisplayOptions) &&
	      // Optional 002 extension: absent, or a string when present (FR-020).
	      (candidate.semanticScholarApiKey === undefined ||
		         typeof candidate.semanticScholarApiKey === 'string') &&
	      (candidate.backfillLargeWindowNoticeEnabled === undefined ||
		         typeof candidate.backfillLargeWindowNoticeEnabled === 'boolean') &&
	      // Optional 004 extensions: absent, or a string when present (FR-006/FR-010).
	      // Unknown keys are not rejected, so a stored embeddingProvider /
	      // localEmbeddingModel / embeddingCredential from before the embedding redesign
	      // is ignored rather than treated as corruption.
	      (candidate.summarizationProvider === undefined ||
		         typeof candidate.summarizationProvider === 'string') &&
	      (candidate.summarizationCredential === undefined ||
		         typeof candidate.summarizationCredential === 'string') &&
	      (candidate.autoCollectionEnabled === undefined ||
		         typeof candidate.autoCollectionEnabled === 'boolean') &&
	      (candidate.renderWindowYears === undefined ||
		         (typeof candidate.renderWindowYears === 'number' &&
			            Number.isFinite(candidate.renderWindowYears) &&
			            candidate.renderWindowYears >= 0))
	    );
}
