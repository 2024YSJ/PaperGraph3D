import type { PaperSourceId } from '../models/paper';

// Shared in-flight guard serializing single-vs-bulk overlap (FR-006/FR-012) and
// carrying the bulk cancel signal (FR-022). One instance per plugin session, owned
// by 008's wiring and injected into both refreshOne and runBulkRefresh.
// research.md Decisions 3 / 12.
export interface ConcurrencyGuard {
	claimSingle(sourceId: PaperSourceId): boolean; // false if already claimed by single or bulk
	releaseSingle(sourceId: PaperSourceId): void;
	claimBulk(): boolean; // false if a bulk run is already active
	releaseBulk(): void; // also clears any pending cancel request
	claimForBulkItem(sourceId: PaperSourceId): boolean; // false if a concurrent single refresh holds it
	releaseForBulkItem(sourceId: PaperSourceId): void;
	requestBulkCancel(): void; // no-op if no bulk run is active
	isBulkCancelRequested(): boolean; // checked by runBulkRefresh between papers
}

export function createConcurrencyGuard(): ConcurrencyGuard {
	// One shared Set backs both single and bulk-item claims, so a single-paper claim
	// and a bulk-item claim on the same sourceId can never both succeed (FR-006/FR-012).
	const inFlight = new Set<PaperSourceId>();
	let bulkActive = false;
	let bulkCancelRequested = false;

	const claim = (sourceId: PaperSourceId): boolean => {
		if (inFlight.has(sourceId)) {
			return false;
		}
		inFlight.add(sourceId);
		return true;
	};

	const release = (sourceId: PaperSourceId): void => {
		inFlight.delete(sourceId);
	};

	return {
		claimSingle: claim,
		releaseSingle: release,
		claimForBulkItem: claim,
		releaseForBulkItem: release,
		claimBulk(): boolean {
			if (bulkActive) {
				return false;
			}
			bulkActive = true;
			bulkCancelRequested = false;
			return true;
		},
		releaseBulk(): void {
			bulkActive = false;
			bulkCancelRequested = false;
		},
		requestBulkCancel(): void {
			if (bulkActive) {
				bulkCancelRequested = true;
			}
		},
		isBulkCancelRequested(): boolean {
			return bulkCancelRequested;
		},
	};
}
