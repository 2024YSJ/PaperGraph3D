// Minimal ambient declaration for the optional @huggingface/transformers runtime
// used by the local-transformer embedding provider (002 FR-046). The package is
// NOT bundled (marked external in esbuild.config.mjs) and is not a hard
// dependency; this shim types only the small surface localTransformer.ts uses so
// the project type-checks without installing the heavy dependency. At runtime the
// module is loaded via a lazy dynamic import, and any failure (module absent,
// model unreadable) falls back to the bundled baseline embedding (002 FR-044).
declare module '@huggingface/transformers' {
	export interface FeatureExtractionOptions {
		pooling?: 'none' | 'mean' | 'cls';
		normalize?: boolean;
	}

	export interface Tensor {
		data: Float32Array | number[];
		dims: number[];
	}

	export type FeatureExtractionPipeline = (
		text: string,
		options?: FeatureExtractionOptions,
	) => Promise<Tensor>;

	export function pipeline(
		task: 'feature-extraction',
		model: string,
		options?: Record<string, unknown>,
	): Promise<FeatureExtractionPipeline>;

	export const env: {
		allowLocalModels: boolean;
		allowRemoteModels: boolean;
		localModelPath: string;
		[key: string]: unknown;
	};
}
