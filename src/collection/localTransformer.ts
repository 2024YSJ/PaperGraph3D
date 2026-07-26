import type { EmbeddingFailureReason } from '../models/paper';
import type { EmbeddingResult } from './embedding';
import { MODEL_ID, type LocalModelLocation } from './modelAssets';

// On-device SPECTER2 embedding (002 FR-046). SPECTER2 is a BERT-base encoder trained
// on 6M citation triplets across 23 fields of study, with the `proximity` adapter
// merged into the ONNX graph at conversion time — citation-trained representations are
// what make a similarity graph meaningful (a plain scientific LM like SciBERT scores
// 59.6 on SciDocs vs SPECTER's 80.0; the gap is the citation objective, not the domain).
//
// The model is fixed, not user-selectable: the corpus's canonical embedding space must
// be exactly one space for the graph feature to project papers together (001 FR-020),
// and a swappable model means a swappable dimensionality.
//
// Weights are not bundled — they are downloaded once into the plugin folder (see
// modelAssets.ts) and everything after that is offline. Until they are present this
// module is never reached; availability is embeddingUpgrade.ts's check.

// The canonical embedding-space id, shaped like the baseline's `local-hashtf-v1-d2048`.
// The dimension is baked in, so any future model change is necessarily a different id
// and reembed.ts converges the corpus onto it (001 FR-022).
export const SPECTER2_EMBEDDING_MODEL = 'local-specter2-proximity-v1-d768';

export const SPECTER2_EMBEDDING_DIM = 768;

// BERT-base's positional limit, and the tokenizer's model_max_length.
const MAX_SEQUENCE_LENGTH = 512;

// The fixed sequence lengths every input is padded UP to.
//
// This is what stops the runtime exhausting itself part-way through a corpus.
// onnxruntime-web plans its memory per input shape, and its WASM heap only ever grows
// — a shape it has not seen extends the arena, and nothing shrinks back. Feeding it a
// novel shape per paper therefore grew the arena until allocation failed, which is why
// embedding died somewhere around one to two hundred papers with the exact count
// tracking the abstract lengths in that batch rather than a fixed number.
//
// transformers.js's feature-extraction pipeline made a novel shape per paper
// unavoidable: it hardcodes `padding: true`, which for a single input resolves to "pad
// to the longest sequence in the batch" — that is, to the input's own length. Driving
// the tokenizer and model directly lets us pad to one of three fixed lengths instead,
// so the runtime sees three shapes for a corpus of any size and reaches a steady state
// after the first paper in each bucket.
//
// Bucketing cannot change the result: pad positions are zeroed in the attention mask
// and we pool the CLS token, so a padded vector is what an exactly-sized input yields.
const LENGTH_BUCKETS = [128, 256, MAX_SEQUENCE_LENGTH] as const;

// Retire and rebuild the session after this many inferences. Fixed shapes bound the
// growth but do not eliminate it — ORT accumulates some per-run state regardless — and
// releasing the InferenceSession is the only way to hand its allocations back.
//
// Set below the ~88 papers at which the runtime was observed to die before bucketing,
// so the backstop fires inside the range that actually failed rather than assuming the
// primary fix holds. The rebuild costs one local model read, amortized over 64 papers
// and small next to 64 BERT forward passes.
const INFERENCES_PER_SESSION = 64;

// The transformers.js surface we use, narrowed to what we call. Its published types
// are generic over every task and architecture, and instantiating them produces a
// union TypeScript refuses to represent ("union type that is too complex"), so the
// import is cast to these signatures instead.
interface Tensor {
	readonly dims: readonly number[];
	readonly data: ArrayLike<number>;
}

interface Encoded {
	readonly input_ids: Tensor;
	readonly attention_mask: Tensor;
}

interface TokenizeOptions {
	readonly padding: boolean | 'max_length';
	readonly truncation: boolean;
	readonly max_length: number;
}

type Tokenizer = (text: string, options: TokenizeOptions) => Encoded;

interface Model {
	(inputs: Encoded): Promise<{ last_hidden_state: Tensor }>;
	dispose(): Promise<void>;
}

interface AutoFactory<T> {
	from_pretrained(model: string, options?: Record<string, unknown>): Promise<T>;
}

interface Session {
	readonly tokenizer: Tokenizer;
	readonly model: Model;
	/** Inferences served by this session, against INFERENCES_PER_SESSION. */
	uses: number;
}

let cachedKey: string | undefined;
let cachedSession: Promise<Session> | undefined;

async function createSession(location: LocalModelLocation): Promise<Session> {
	const transformers = await import('@huggingface/transformers');

	// Local-only, always. allowRemoteModels=false is what makes "offline after
	// first download" a guarantee rather than an intention: if an asset is
	// missing the load fails loudly here instead of silently reaching the
	// network (constitution Principle IV).
	transformers.env.allowLocalModels = true;
	transformers.env.allowRemoteModels = false;
	transformers.env.localModelPath = location.modelsBaseUrl;

	const wasm = transformers.env.backends.onnx.wasm;
	if (wasm === undefined) {
		throw new Error('onnxruntime WASM backend unavailable');
	}

	// Clearing wasmPaths is load-bearing, not tidying. ORT skips its own embedded
	// loader glue whenever a path prefix is set (`importWasmModule`) and
	// dynamic-imports the glue from that prefix instead — which Obsidian's CSP
	// blocks. transformers.js sets that prefix to a jsDelivr CDN URL at import
	// time, so the embedded glue is unreachable, and the plugin silently reaches
	// the network on every load (Principle IV), unless we take it back out.
	wasm.wasmPaths = undefined;

	// With no prefix to fetch from, hand ORT the binary itself: embedded glue,
	// local bytes, nothing left to load. Re-read per session rather than held in a
	// module-level cache — 21 MB retained for the plugin's whole lifetime costs more
	// than re-reading it once every INFERENCES_PER_SESSION papers.
	wasm.wasmBinary = await location.readWasmBinary();

	const autoTokenizer = transformers.AutoTokenizer as unknown as AutoFactory<Tokenizer>;
	const autoModel = transformers.AutoModel as unknown as AutoFactory<Model>;

	const tokenizer = await autoTokenizer.from_pretrained(MODEL_ID);
	const model = await autoModel.from_pretrained(MODEL_ID, {
		// Resolves to onnx/model_quantized.onnx. The fp32 export is a small graph
		// plus a 420 MB external-data sidecar, so int8 is the only shipped weight.
		dtype: 'q8',
		session_options: {
			// The arena trades memory for allocation speed by holding freed blocks for
			// reuse. With the shape count fixed at three there is nothing left for it to
			// amortize, and it is the structure that grew without bound, so it is off.
			enableCpuMemArena: false,
		},
	});

	return { tokenizer, model, uses: 0 };
}

async function getSession(location: LocalModelLocation): Promise<Session> {
	const key = location.modelsBaseUrl;
	if (cachedKey !== key || cachedSession === undefined) {
		const creating = createSession(location);
		cachedKey = key;
		cachedSession = creating;
		// A rejected promise must not stay cached. It used to: one failed load — a
		// missing asset, a CSP block — was replayed to every later caller, so the model
		// stayed dead for the rest of the session even after the cause was fixed.
		creating.catch(() => {
			if (cachedSession === creating) {
				cachedKey = undefined;
				cachedSession = undefined;
			}
		});
	}
	return cachedSession;
}

/**
 * Drop the cached session, releasing the runtime's InferenceSession so its allocations
 * return to the WASM heap's allocator. (The heap's high-water mark does not fall — a
 * WebAssembly.Memory never shrinks — but the space becomes reusable, which is what an
 * exhausted runtime needs.)
 *
 * Call after assets are re-downloaded or removed, and after any inference failure.
 */
export async function resetPipeline(): Promise<void> {
	const pending = cachedSession;
	cachedKey = undefined;
	cachedSession = undefined;
	if (pending === undefined) {
		return;
	}
	try {
		const session = await pending;
		await session.model.dispose();
	} catch {
		// Either the session never loaded or disposal itself failed. The reference is
		// already dropped, which is the part that matters.
	}
}

// WASM exhaustion surfaces through several unrelated layers — Emscripten's abort path,
// WebAssembly.Memory growth failure, ORT's own allocator, and the JS heap when a large
// typed array cannot be allocated — with no error type in common, so the message is all
// there is to classify on. An unrecognized failure stays 'inference-error' rather than
// being reported as something we did not actually diagnose.
const OUT_OF_MEMORY_PATTERNS = [
	'out of memory',
	'could not allocate memory',
	'cannot enlarge memory',
	'failed to allocate',
	'memory access out of bounds',
	'array buffer allocation failed',
	'aborted(',
];

export function classifyInferenceError(error: unknown): EmbeddingFailureReason {
	const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
	return OUT_OF_MEMORY_PATTERNS.some((pattern) => message.includes(pattern))
		? 'out-of-memory'
		: 'inference-error';
}

function bucketFor(tokenCount: number): number {
	return LENGTH_BUCKETS.find((bucket) => tokenCount <= bucket) ?? MAX_SEQUENCE_LENGTH;
}

function l2Normalize(vector: number[]): number[] {
	let sumOfSquares = 0;
	for (const value of vector) {
		sumOfSquares += value * value;
	}
	const norm = Math.sqrt(sumOfSquares);
	return norm === 0 ? vector : vector.map((value) => value / norm);
}

async function embedOnce(session: Session, text: string): Promise<number[]> {
	// Measure the real token count first, then pad up to a bucket. Tokenizing twice is
	// microseconds against a BERT forward pass, and it is what holds the shape count at
	// three.
	const measured = session.tokenizer(text, {
		padding: false,
		truncation: true,
		max_length: MAX_SEQUENCE_LENGTH,
	});
	const tokenCount = measured.input_ids.dims[1] ?? MAX_SEQUENCE_LENGTH;

	const inputs = session.tokenizer(text, {
		padding: 'max_length',
		truncation: true,
		max_length: bucketFor(tokenCount),
	});

	const { last_hidden_state: hidden } = await session.model(inputs);
	session.uses += 1;

	// [batch, sequence, hidden] with batch 1, so the CLS token is the first
	// SPECTER2_EMBEDDING_DIM values of the row-major buffer. Padding cannot reach it —
	// the attention mask zeroes those positions.
	const hiddenSize = hidden.dims[2] ?? 0;
	if (hiddenSize !== SPECTER2_EMBEDDING_DIM) {
		throw new Error(
			`SPECTER2 produced a ${hiddenSize}-d hidden state, expected ${SPECTER2_EMBEDDING_DIM}`,
		);
	}

	const cls = new Array<number>(SPECTER2_EMBEDDING_DIM);
	for (let i = 0; i < SPECTER2_EMBEDDING_DIM; i += 1) {
		cls[i] = Number(hidden.data[i] ?? Number.NaN);
	}
	return l2Normalize(cls);
}

/**
 * Embed one paper in the canonical SPECTER2 space.
 *
 * THROWS on failure, deliberately. The previous version returned undefined for both
 * "the model is not installed" and "inference failed", which left callers unable to
 * tell an expected state from a fault — and is why an exhausted runtime silently
 * downgraded every remaining paper to the lexical baseline with nothing recorded.
 * Availability is the caller's check (embeddingUpgrade.ts); anything that reaches here
 * is expected to work, so a failure is news and travels as an exception.
 */
export async function specter2Embedding(
	title: string,
	abstract: string,
	location: LocalModelLocation,
): Promise<EmbeddingResult> {
	// SPECTER2's trained input format: title, a [SEP], then the abstract. Verified that
	// a literal '[SEP]' in the string tokenizes identically to tokenizer.sep_token, so
	// this matches how the model was trained. A space-joined string would quietly
	// produce worse embeddings, as would mean pooling instead of the CLS token.
	const text = abstract.length > 0 ? `${title}[SEP]${abstract}` : title;

	let session = await getSession(location);
	if (session.uses >= INFERENCES_PER_SESSION) {
		await resetPipeline();
		session = await getSession(location);
	}

	let embedding: number[];
	try {
		embedding = await embedOnce(session, text);
	} catch {
		// Retry once on a FRESH session. Retrying on the same one is pointless — an
		// exhausted heap does not recover in place, which is exactly why every paper
		// after the first failure used to fail too — and releasing the session returns
		// its allocations to the allocator, so the retry has room to work. If this
		// throws as well the caller records a failure and its breaker stops the bleeding.
		await resetPipeline();
		const replacement = await getSession(location);
		embedding = await embedOnce(replacement, text);
	}

	if (embedding.some((value) => !Number.isFinite(value))) {
		throw new Error('SPECTER2 produced a non-finite embedding');
	}

	return {
		embedding,
		embeddingModel: SPECTER2_EMBEDDING_MODEL,
		embeddingSource: 'local',
	};
}
