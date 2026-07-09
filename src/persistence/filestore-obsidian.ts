import { normalizePath, type App } from 'obsidian';
import type { FileStore } from './filestore';

// The ONLY Obsidian-touching module. Confines all vault I/O to `baseFolder`
// (FR-006) via the Vault DataAdapter, taking store-relative paths and resolving
// them under the base. Verified by the manual in-vault smoke (tasks T019).
export function createObsidianFileStore(app: App, baseFolder: string): FileStore {
	const base = normalizePath(baseFolder);
	const full = (path: string): string => normalizePath(`${base}/${path}`);
	const adapter = app.vault.adapter;

	const ensureBase = async (): Promise<void> => {
		if (!(await adapter.exists(base))) {
			await adapter.mkdir(base);
		}
	};

	return {
		async read(path) {
			const p = full(path);
			return (await adapter.exists(p)) ? adapter.read(p) : null;
		},
		async write(path, content) {
			await ensureBase();
			await adapter.write(full(path), content);
		},
		async delete(path) {
			const p = full(path);
			if (await adapter.exists(p)) {
				await adapter.remove(p);
			}
		},
		async exists(path) {
			return adapter.exists(full(path));
		},
		async list() {
			await ensureBase();
			const listing = await adapter.list(base);
			const prefix = `${base}/`;
			return listing.files.map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f));
		},
	};
}
