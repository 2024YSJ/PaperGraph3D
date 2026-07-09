import type { PaperSourceId } from '../models/paper';
import type { PaperRecord } from './record';

// Lightweight per-paper metadata kept resident. The embedding VECTOR, references,
// abstract, and prose are intentionally excluded and read on demand (SC-006,
// Clarification 2026-07-08).
export interface IndexEntry {
	sourceId: PaperSourceId;
	fileStem: string;
	title: string;
	authors: string[];
	publicationYear: number;
	citationCount: number;
	readState: string;
	embeddingModel: string | null;
	embeddingPending: boolean;
	schemaVersion: number;
	createdAt: number;
	updatedAt: number;
}

export function entryFromRecord(record: PaperRecord, fileStem: string): IndexEntry {
	const p = record.paper;
	return {
		sourceId: p.sourceId,
		fileStem,
		title: p.title,
		authors: p.authors,
		publicationYear: p.publicationYear,
		citationCount: p.citationCount,
		readState: record.readState,
		embeddingModel: p.embeddingModel,
		embeddingPending: p.embedding === null,
		schemaVersion: record.schemaVersion,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};
}

// Session-long in-memory index (a cache of the authoritative on-disk records).
export class RecordIndex {
	private map = new Map<string, IndexEntry>();

	has(sourceId: PaperSourceId): boolean {
		return this.map.has(sourceId);
	}

	get(sourceId: PaperSourceId): IndexEntry | undefined {
		return this.map.get(sourceId);
	}

	set(entry: IndexEntry): void {
		this.map.set(entry.sourceId, entry);
	}

	remove(sourceId: PaperSourceId): void {
		this.map.delete(sourceId);
	}

	clear(): void {
		this.map.clear();
	}

	values(): IterableIterator<IndexEntry> {
		return this.map.values();
	}

	get size(): number {
		return this.map.size;
	}

	// Used by fileStem() to guarantee injective filenames (FR-007).
	usedStems(): Set<string> {
		const stems = new Set<string>();
		for (const entry of this.map.values()) {
			stems.add(entry.fileStem);
		}
		return stems;
	}
}
