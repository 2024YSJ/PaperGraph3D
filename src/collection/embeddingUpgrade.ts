import type { EmbeddingResult } from './embedding';
import { specter2Embedding } from './localTransformer';
import type { LocalModelLocation } from './modelAssets';

// Where the on-device model lives, read per paper so that assets arriving mid-batch
// take effect for later papers (mirrors summarization's live read, 002 FR-021).
//
// There is no provider selector any more (001 FR-022 superseded): the canonical
// embedding space is always SPECTER2. A user-chosen provider meant a user-chosen
// dimensionality, and only vectors sharing one space can be projected together by the
// graph feature (001 FR-020) — so the choice was never really available to make.
export interface EmbeddingConfig {
	/** Absent until the user has downloaded the model (modelAssets.ts). */
	location?: LocalModelLocation;
}

// Attempt to upgrade the always-present bundled baseline to the canonical SPECTER2
// embedding (002 FR-045). Returns undefined when the model has not been downloaded
// yet, or when inference failed — the caller then keeps the baseline vector (pending
// upgrade), never blocking persistence (001 FR-021). Never throws.
export async function upgradeEmbedding(
	title: string,
	abstract: string,
	config: EmbeddingConfig,
): Promise<EmbeddingResult | undefined> {
	if (config.location === undefined) {
		return undefined;
	}
	try {
		return await specter2Embedding(title, abstract, config.location);
	} catch {
		return undefined;
	}
}
