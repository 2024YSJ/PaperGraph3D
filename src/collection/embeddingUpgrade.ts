import type { EmbeddingProvider } from '../models/settings';
import type { EmbeddingResult } from './embedding';
import { localTransformerEmbedding } from './localTransformer';
import { llmEmbeddingUpgrade } from '../services/summarization/embeddingHook';

// The live embedding-provider selection (001 FR-022), read per paper so a settings
// change mid-batch takes effect for later papers (mirrors summarization's live
// read, 002 FR-021).
export interface EmbeddingConfig {
	provider: EmbeddingProvider;
	localModel?: string;
	// 004-owned (FR-010). Plaintext credential for the LLM embedding upgrade, read
	// only when provider === 'llm'. Independent of the summarization credential.
	credential?: string;
}

// Attempt to upgrade the always-present bundled baseline to the selected canonical
// provider's embedding (001 FR-022 / 002 FR-045). Returns undefined when there is
// nothing to upgrade ('bundled') or when the upgrade could not be produced (a
// failure, or an unimplemented provider) — the caller then keeps the baseline
// vector (pending upgrade), never blocking persistence. Never throws.
export async function upgradeEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
): Promise<EmbeddingResult | undefined> {
	try {
		switch (config.provider) {
			case 'local-transformer': {
				const model = config.localModel?.trim();
				if (model === undefined || model.length === 0) {
					return undefined;
				}
				return await localTransformerEmbedding(title, abstract, model);
			}
			case 'llm': {
				// 004-owned (002 FR-045). No/empty credential -> undefined, baseline kept
				// (pending) — matches every other provider's "nothing configured" contract.
				const credential = config.credential?.trim();
				if (credential === undefined || credential.length === 0) {
					return undefined;
				}
				return await llmEmbeddingUpgrade(title, abstract, credential);
			}
			case 'bundled':
			default:
				return undefined;
		}
	} catch {
		return undefined;
	}
}
