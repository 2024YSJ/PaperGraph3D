import { requestUrl, type DataAdapter } from 'obsidian';

// First-run delivery of the on-device embedding runtime's assets (002 FR-046).
//
// Obsidian's installer copies only main.js/manifest.json/styles.css out of a
// release, so neither the SPECTER2 weights (~108 MB) nor the onnxruntime WASM
// binary (~21 MB) can ship with the plugin — inlining them into main.js would mean
// a ~170 MB bundle parsed on every startup. They are fetched once into the plugin's
// own folder instead; from then on the embedding path is fully offline and no
// paper data ever leaves the vault.
//
// This is a user-initiated external download and MUST stay opt-in and disclosed
// (constitution Principle IV) — nothing here may run without an explicit user act.

// The model repo is a straight ONNX conversion of allenai/specter2_base with the
// allenai/specter2 proximity adapter merged into the graph (Apache-2.0).
const MODEL_REPO = 'papergraph3d/specter2-proximity-onnx';
const MODEL_REVISION = 'main';

// Pinned to the exact @huggingface/transformers version bundled into main.js: the
// WASM binary and the JS glue that loads it are one unit, and a mismatch is an
// obscure runtime failure. Bump both together or not at all.
const TRANSFORMERS_VERSION = '3.8.1';

// Only the binary. The .mjs glue that loads it is compiled into main.js (esbuild
// resolves onnxruntime-web to dist/ort.bundle.min.mjs, whose glue is embedded), so it
// is never fetched — see the import.meta.url define in esbuild.config.mjs, which is
// what lets ORT use that embedded copy.
const WASM_FILE = 'ort-wasm-simd-threaded.jsep.wasm';

// Relative to the plugin folder. transformers.js resolves a model as
// `${localModelPath}/${modelId}/...`, so the weights live one level down under the
// model id rather than directly in MODELS_SUBDIR.
export const MODELS_SUBDIR = 'models';
export const WASM_SUBDIR = 'wasm';
export const MODEL_ID = 'specter2-proximity-onnx';

// Every file transformers.js needs. `tokenizer.json` is not optional: transformers.js
// has no vocab.txt loader, and upstream specter2_base ships no fast-tokenizer JSON —
// ours is generated during conversion. `onnx/model_quantized.onnx` is the q8 filename
// convention (dtype 'q8' -> the '_quantized' suffix); it is self-contained, with no
// external-data sidecar.
const MODEL_FILES = [
	'config.json',
	'tokenizer.json',
	'tokenizer_config.json',
	'special_tokens_map.json',
	'onnx/model_quantized.onnx',
] as const;

export interface AssetProgress {
	/** 1-based index of the file currently being fetched. */
	readonly fileIndex: number;
	readonly fileCount: number;
	readonly fileName: string;
	readonly bytesWritten: number;
}

export interface AssetPaths {
	/** Vault-relative. Pass to transformers.js as env.localModelPath (via a resource URL). */
	readonly modelsDir: string;
	/** Vault-relative. Pass to transformers.js as env.backends.onnx.wasm.wasmPaths. */
	readonly wasmDir: string;
	/** Vault-relative path of the model folder itself. */
	readonly modelDir: string;
}

export function assetPaths(manifestDir: string): AssetPaths {
	const modelsDir = `${manifestDir}/${MODELS_SUBDIR}`;
	return {
		modelsDir,
		wasmDir: `${manifestDir}/${WASM_SUBDIR}`,
		modelDir: `${modelsDir}/${MODEL_ID}`,
	};
}

function modelFileUrl(file: string): string {
	return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${file}`;
}

function wasmFileUrl(): string {
	return `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/${WASM_FILE}`;
}

/**
 * True only when every required asset is on disk. Deliberately all-or-nothing: a
 * half-downloaded set is indistinguishable from a complete one to transformers.js,
 * which would fail deep inside the runtime with an unhelpful error instead of here.
 */
export async function areAssetsPresent(
	adapter: DataAdapter,
	paths: AssetPaths,
): Promise<boolean> {
	const required = [
		...MODEL_FILES.map((f) => `${paths.modelDir}/${f}`),
		`${paths.wasmDir}/${WASM_FILE}`,
	];
	for (const path of required) {
		if (!(await adapter.exists(path))) {
			return false;
		}
	}
	return true;
}

async function ensureDir(adapter: DataAdapter, dir: string): Promise<void> {
	if (!(await adapter.exists(dir))) {
		await adapter.mkdir(dir);
	}
}

/**
 * Fetch one file through Obsidian's requestUrl (main-process, so no CORS wall) and
 * write it atomically: a partial write that later looks "present" would poison
 * areAssetsPresent() on the next load, so the bytes land on a .part file that is
 * only renamed once complete.
 */
async function fetchTo(
	adapter: DataAdapter,
	url: string,
	dest: string,
): Promise<number> {
	const response = await requestUrl({ url, method: 'GET', throw: false });
	if (response.status !== 200) {
		throw new Error(`${url} -> HTTP ${response.status}`);
	}
	const bytes = response.arrayBuffer;
	const temp = `${dest}.part`;
	await adapter.writeBinary(temp, bytes);
	if (await adapter.exists(dest)) {
		await adapter.remove(dest);
	}
	await adapter.rename(temp, dest);
	return bytes.byteLength;
}

/**
 * Download every asset. Sequential on purpose — this is ~130 MB and the point is a
 * legible progress report, not throughput.
 *
 * Leaves the folder clean on failure so a retry starts from a known state, and
 * rethrows: the caller decides what the user sees. Callers must keep treating the
 * embedding as unavailable (baseline retained) until this resolves.
 */
export async function downloadAssets(
	adapter: DataAdapter,
	paths: AssetPaths,
	onProgress?: (progress: AssetProgress) => void,
): Promise<void> {
	const jobs: { url: string; dest: string; name: string }[] = [
		...MODEL_FILES.map((f) => ({
			url: modelFileUrl(f),
			dest: `${paths.modelDir}/${f}`,
			name: f,
		})),
		{ url: wasmFileUrl(), dest: `${paths.wasmDir}/${WASM_FILE}`, name: WASM_FILE },
	];

	await ensureDir(adapter, paths.modelsDir);
	await ensureDir(adapter, paths.modelDir);
	await ensureDir(adapter, `${paths.modelDir}/onnx`);
	await ensureDir(adapter, paths.wasmDir);

	try {
		let index = 0;
		for (const job of jobs) {
			index += 1;
			const bytesWritten = await fetchTo(adapter, job.url, job.dest);
			onProgress?.({
				fileIndex: index,
				fileCount: jobs.length,
				fileName: job.name,
				bytesWritten,
			});
		}
	} catch (error) {
		await removeAssets(adapter, paths).catch(() => undefined);
		throw error;
	}
}

/** Delete downloaded assets, e.g. to reclaim the ~130 MB or to force a clean retry. */
export async function removeAssets(
	adapter: DataAdapter,
	paths: AssetPaths,
): Promise<void> {
	for (const dir of [paths.modelsDir, paths.wasmDir]) {
		if (await adapter.exists(dir)) {
			await adapter.rmdir(dir, true);
		}
	}
}

/**
 * How the downloaded assets reach the runtime. The two halves get there differently
 * because the two consumers are different:
 *
 * - Model files go to transformers.js, whose web build has no filesystem access and
 *   fetches them, so they must be resource URLs (Obsidian's `app://`).
 * - The WASM binary goes to onnxruntime as raw bytes. Handing it a URL instead makes
 *   ORT fetch it AND dynamic-import its loader glue from the same prefix, which
 *   Obsidian's CSP blocks; handing over the bytes skips both.
 */
export interface LocalModelLocation {
	/** Base URL for models; transformers.js appends `/<model id>/<file>`. */
	readonly modelsBaseUrl: string;
	/** Reads the ~21 MB WASM binary. Lazy — nothing holds it until an embedding runs. */
	readWasmBinary(): Promise<ArrayBuffer>;
}

function resourceBaseUrl(adapter: DataAdapter, dir: string): string {
	// getResourcePath appends a cache-busting query string, which would land in the
	// middle of the URL once transformers.js concatenates the file name onto it.
	const url = adapter.getResourcePath(dir);
	const query = url.indexOf('?');
	return query === -1 ? url : url.slice(0, query);
}

/**
 * Resolve fetchable URLs for the downloaded assets, or undefined when they are not
 * all present — which is what keeps callers on the bundled baseline until the user
 * has opted into the download.
 */
export async function resolveModelLocation(
	adapter: DataAdapter,
	paths: AssetPaths,
): Promise<LocalModelLocation | undefined> {
	if (!(await areAssetsPresent(adapter, paths))) {
		return undefined;
	}
	return {
		modelsBaseUrl: resourceBaseUrl(adapter, paths.modelsDir),
		readWasmBinary: () => adapter.readBinary(`${paths.wasmDir}/${WASM_FILE}`),
	};
}
