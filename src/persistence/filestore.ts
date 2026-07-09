// FileStore port + in-memory verification fake. Kept Obsidian-free so the whole
// persistence core is runnable offline (research.md §1). The production Vault
// adapter lives in filestore-obsidian.ts — the only Obsidian-touching module.

// All paths are relative to the store's base folder (FR-006); an implementation
// MUST never read or write outside it. `list()` returns paths relative to the base.
export interface FileStore {
	read(path: string): Promise<string | null>; // null when the file is absent
	write(path: string, content: string): Promise<void>;
	delete(path: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	list(): Promise<string[]>;
}

// In-memory FileStore used by quickstart.md to exercise the core offline.
export class InMemoryFileStore implements FileStore {
	private files = new Map<string, string>();

	async read(path: string): Promise<string | null> {
		return this.files.has(path) ? (this.files.get(path) as string) : null;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async delete(path: string): Promise<void> {
		this.files.delete(path);
	}

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async list(): Promise<string[]> {
		return [...this.files.keys()];
	}
}
