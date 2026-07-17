import type { SummarizationProvider } from '../types';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { openAiProvider } from './openai';

// The full set of user-selectable summarization providers, keyed by the id stored
// in PluginSettings.summarizationProvider. main.ts resolves the live selection
// through resolveSummarizationProvider(); an absent or unrecognized id yields
// undefined, which createSummarizeHook() treats as "not configured" (no
// summarization call is attempted) — exactly the contract main.ts relied on when
// 'openai' was the only recognized id.
//
// This registry is summarization-only. Anthropic/Claude has no first-party
// embeddings API, and widening the embedding-upgrade path (embeddingUpgrade.ts) is
// 002-owned, so this file deliberately does not model embedding providers. 008's
// settings UI can enumerate the selectable ids via Object.keys(SUMMARIZATION_PROVIDERS).
export const SUMMARIZATION_PROVIDERS: Record<string, SummarizationProvider> = {
	[openAiProvider.id]: openAiProvider,
	[anthropicProvider.id]: anthropicProvider,
	[geminiProvider.id]: geminiProvider,
};

// The recognized ids, in a stable display order, for a settings selector to render.
export const SUMMARIZATION_PROVIDER_IDS = [
	openAiProvider.id,
	anthropicProvider.id,
	geminiProvider.id,
] as const;

export function resolveSummarizationProvider(
	id: string | undefined,
): SummarizationProvider | undefined {
	if (id === undefined) {
		return undefined;
	}
	return SUMMARIZATION_PROVIDERS[id];
}
