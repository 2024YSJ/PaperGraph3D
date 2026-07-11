import type { EmbeddingResult } from '../../collection/embedding';
import { llmEmbeddingModelId } from './constants';
import { runEmbeddingGeneration } from './generate';
import { openAiEmbeddingProvider } from './providers/openai';
import type { LlmEmbeddingProvider } from './types';

// Fixed to the OpenAI reference provider for now (research.md §4) — a future
// multi-provider LLM embedding selection is out of scope for this feature.
export interface EmbeddingHookConfig {
	getProvider: () => LlmEmbeddingProvider;
}

const defaultConfig: EmbeddingHookConfig = {
	getProvider: () => openAiEmbeddingProvider,
};

// Matches upgradeEmbedding()'s existing 'local-transformer' branch's "any
// failure -> undefined, caller keeps the baseline" contract exactly (data-model.md
// §1, research.md §8). Never throws.
export async function llmEmbeddingUpgrade(
	title: string,
	abstract: string,
	credential: string | undefined,
	config: EmbeddingHookConfig = defaultConfig,
): Promise<EmbeddingResult | undefined> {
	if (credential === undefined || credential.trim().length === 0) {
		return undefined;
	}

	const provider = config.getProvider();
	const outcome = await runEmbeddingGeneration(title, abstract, provider, credential);

	if (!outcome.ok) {
		return undefined;
	}

	return {
		embedding: outcome.vector,
		// llm:<model-id>:d<dim> (data-model.md §5) — the binding naming contract
		// reembed.ts's isCanonical() depends on. embeddingHook.ts, not the provider,
		// applies this formatting (contracts/summarization-api.md § providers/openai.ts).
		embeddingModel: llmEmbeddingModelId(outcome.model, outcome.vector.length),
		embeddingSource: 'llm',
	};
}
