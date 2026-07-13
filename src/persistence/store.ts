import type { Paper, PaperSourceId } from '../models/paper';
import type { FileStore } from './filestore';
import { RecordIndex, entryFromRecord } from './index';
import { migrate, unwrap, wrap, type PaperRecord, type PersistInput } from './record';
import { parseNote, renderNote } from './note';
import { noteStem } from './filename';
import { classify, stemOf, tombstoneName } from './reconcile';

export type { PersistInput } from './record';

export interface PaperStoreOptions {
	// User-facing messages (folder problems, orphan reports). Production wiring (008)
	// passes an Obsidian Notice-backed notifier; kept as a callback so the store stays
	// Obsidian-free and offline-testable. Copy MUST follow the bilingual policy.
	notify?: (message: string) => void;
}

const serialize = (record: PaperRecord): string => JSON.stringify(record, null, 2);

// Coordinated, per-paper-serialized persistence of the .json+.md pairing, plus the
// FR-015 read/query API that 002/005/006 consume. All I/O is confined to the base
// folder by the injected FileStore (FR-006).
export class PaperStore {
	private readonly index = new RecordIndex();
	private readonly chain = new Map<string, Promise<unknown>>();

	constructor(
		private fs: FileStore,
		private readonly options: PaperStoreOptions = {},
	) {}

	// Serialize operations targeting the SAME sourceId so a collection persist, a
	// refresh, and a delete never interleave (FR-014); different papers run freely.
	private run<T>(key: string, task: () => Promise<T>): Promise<T> {
		const prev = this.chain.get(key) ?? Promise.resolve();
		const result = prev.then(task, task);
		this.chain.set(
			key,
			result.then(
				() => undefined,
				() => undefined,
			),
		);
		return result;
	}

	private notify(message: string): void {
		this.options.notify?.(message);
	}

	// Build the index from the folder; resume tombstoned deletes and reconcile
	// orphans JSON-authoritatively. Metadata only — no embedding vectors (SC-006).
	async load(): Promise<void> {
		this.index.clear();
		let files: string[];
		try {
			files = await this.fs.list();
		} catch (err) {
			this.notify(`Storage folder could not be read: ${String(err)}`);
			return;
		}

		const tombStems = new Set<string>();
		for (const f of files) {
			if (classify(f) === 'tombstone') tombStems.add(stemOf(f));
		}
		for (const stem of tombStems) {
			await this.completeDelete(stem); // resume interrupted deletes (FR-021)
		}

		// Pair by CONTENT sourceId, never by filename — rename-safe (FR-009).
		const recBySource = new Map<string, { stem: string; record: PaperRecord }>();
		for (const f of files) {
			if (classify(f) !== 'json' || tombStems.has(stemOf(f))) continue;
			const text = await this.fs.read(f);
			if (text === null) continue;
			let record: PaperRecord;
			try {
				record = migrate(JSON.parse(text));
			} catch {
				this.notify(`Skipped an unreadable record: ${f}`);
				continue;
			}
			recBySource.set(record.paper.sourceId, { stem: stemOf(f), record });
		}

		const noteBySource = new Map<string, string>();
		for (const f of files) {
			if (classify(f) !== 'md' || tombStems.has(stemOf(f))) continue;
			const text = await this.fs.read(f);
			if (text === null) continue;
			const sid = parseNote(text).frontmatter['pg3d_sourceId'];
			if (typeof sid === 'string') noteBySource.set(sid, f);
		}

		for (const [sid, { stem, record }] of recBySource) {
			if (!noteBySource.has(sid)) {
				await this.fs.write(`${stem}.md`, renderNote(record, '')); // rebuild orphan note (FR-013)
			}
			this.index.set(entryFromRecord(record, stem));
		}
		for (const [sid, path] of noteBySource) {
			if (!recBySource.has(sid)) {
				this.notify(`A note has no matching record and was left untouched: ${path}`); // FR-013
			}
		}
	}

	// FR-018: on a storage-folder change, leave existing pairings untouched at the
	// old folder, re-point at the new folder's FileStore and rebuild the index, and
	// inform the user that previously stored papers remain in the old location. The
	// settings change that triggers this is owned by 008, which supplies the new
	// folder's FileStore and the previous folder path.
	async onStorageFolderChanged(previousFolder: string, newFileStore: FileStore): Promise<void> {
		this.fs = newFileStore;
		await this.load();
		this.notify(
			`Storage folder changed. Previously stored papers remain in the old location: ${previousFolder}`,
		);
	}

	// FR-015(a): existence check by sourceId (002 dedup) — index-served.
	has(sourceId: PaperSourceId): boolean {
		return this.index.has(sourceId);
	}

	// FR-015(b): read one record back into a canonical Paper (005) — reads the
	// .json on demand so the embedding vector and references are included.
	async get(sourceId: PaperSourceId): Promise<Paper | undefined> {
		const entry = this.index.get(sourceId);
		if (!entry) return undefined;
		const text = await this.fs.read(`${entry.fileStem}.json`);
		if (text === null) return undefined;
		try {
			return unwrap(migrate(JSON.parse(text)));
		} catch {
			return undefined;
		}
	}

	// FR-015(c): enumerate all stored papers for graph build (006), hydrating each
	// embedding from disk on demand (not resident).
	async *all(): AsyncGenerator<Paper> {
		for (const entry of [...this.index.values()]) {
			const paper = await this.get(entry.sourceId);
			if (paper) yield paper;
		}
	}

	upsert(input: PersistInput): Promise<void> {
		return this.run(input.paper.sourceId, async () => {
			const existing = this.index.get(input.paper.sourceId);
			if (existing) {
				await this.updatePath(input, existing.fileStem);
			} else {
				await this.createPath(input);
			}
		});
	}

	delete(sourceId: PaperSourceId): Promise<void> {
		return this.run(sourceId, async () => {
			const entry = this.index.get(sourceId);
			if (!entry) return;
			await this.completeDelete(entry.fileStem);
			this.index.remove(sourceId);
		});
	}

	private async createPath(input: PersistInput): Promise<void> {
		// Human-readable, date-foldered relative stem `<YYYY>/<MM>/<DD>/<title (id)>`
		// (FR-007). Rename-safe: pairing keys on the content sourceId, not the path (FR-009).
		const stem = noteStem(input.paper, this.index.usedStems());
		const record = wrap(input);
		// Record durably first so an uncontrolled crash leaves a record the note can
		// be rebuilt from rather than a note with no record (FR-021).
		try {
			await this.fs.write(`${stem}.json`, serialize(record));
		} catch (err) {
			// Nothing was written yet, so there is no half-create to undo — inform the
			// user (e.g. the storage folder is inaccessible) and propagate (FR-011).
			this.notify(`Could not write the record (is the storage folder accessible?): ${String(err)}`);
			throw err;
		}
		try {
			await this.fs.write(`${stem}.md`, renderNote(record, ''));
		} catch (err) {
			await this.fs.delete(`${stem}.json`).catch(() => undefined); // roll back to "neither" (FR-011)
			this.notify(`Could not create the note; rolled back: ${String(err)}`);
			throw err;
		}
		this.index.set(entryFromRecord(record, stem));
	}

	private async updatePath(input: PersistInput, stem: string): Promise<void> {
		const prevText = await this.fs.read(`${stem}.json`);
		const prevRecord = prevText !== null ? migrate(JSON.parse(prevText)) : undefined;
		const mdText = await this.fs.read(`${stem}.md`);
		const previousUserBody = mdText !== null ? parseNote(mdText).userBody : '';
		const merged = wrap(input, prevRecord);
		await this.fs.write(`${stem}.json`, serialize(merged));
		await this.fs.write(`${stem}.md`, renderNote(merged, previousUserBody));
		this.index.set(entryFromRecord(merged, stem));
	}

	// Tombstoned two-phase delete: marker first, then note, then record, then
	// marker — recoverable and unambiguous vs a genuine orphan (FR-012/FR-021).
	private async completeDelete(stem: string): Promise<void> {
		await this.fs.write(tombstoneName(stem), JSON.stringify({ stem, at: Date.now() }));
		await this.fs.delete(`${stem}.md`).catch(() => undefined);
		await this.fs.delete(`${stem}.json`).catch(() => undefined);
		await this.fs.delete(tombstoneName(stem)).catch(() => undefined);
	}
}
