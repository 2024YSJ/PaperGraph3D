import { normalizePath, type App } from 'obsidian';
import type { FileStore } from './filestore';

// The ONLY Obsidian-touching module. Confines all vault I/O to `baseFolder`
// (FR-006) via the Vault DataAdapter, taking store-relative paths and resolving
// them under the base. Paths may include `<YYYY>/<MM>/<DD>/` subfolders (FR-007), so
// writes create the parent chain and `list()` recurses. Verified by the manual
// in-vault smoke (tasks T019).
export function createObsidianFileStore(app: App, baseFolder: string): FileStore {
	const base = normalizePath(baseFolder);
	const full = (path: string): string => normalizePath(`${base}/${path}`);
	const adapter = app.vault.adapter;

	// Ensure `base` and each nested segment of `relDir` exist (mkdir -p). `relDir` is
	// store-relative, e.g. '2024/03' (or '' for the base itself).
	const ensureDir = async (relDir: string): Promise<void> => {
		let cur = base;
		if (!(await adapter.exists(cur))) {
			await adapter.mkdir(cur);
		}
		for (const segment of relDir.split('/')) {
			if (segment.length === 0) {
				continue;
			}
			cur = normalizePath(`${cur}/${segment}`);
			if (!(await adapter.exists(cur))) {
				await adapter.mkdir(cur);
			}
		}
	};

	const relativize = (absPath: string): string =>
		absPath.startsWith(`${base}/`) ? absPath.slice(base.length + 1) : absPath;

	return {
		async read(path) {
			const p = full(path);
			return (await adapter.exists(p)) ? adapter.read(p) : null;
		},
		async write(path, content) {
			const slash = path.lastIndexOf('/');
			await ensureDir(slash === -1 ? '' : path.slice(0, slash));
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
			await ensureDir('');
			const files: string[] = [];
			// Depth-first walk over the base and its subfolders — returns every file's
			// store-relative path (incl. the `<YYYY>/<MM>/<DD>/` prefix), matching how the
			// in-memory fake's flat key space already behaves.
			const walk = async (absDir: string): Promise<void> => {
				const listing = await adapter.list(absDir);
				for (const f of listing.files) {
					files.push(relativize(f));
				}
				for (const d of listing.folders) {
					await walk(d);
				}
			};
			await walk(base);
			return files;
		},
	};
}
