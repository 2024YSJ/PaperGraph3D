import type { SummarizationInput, SummaryResult } from '../../collection/pipeline';
import { runGeneration } from './generate';
import { isUncited } from './isUncited';
import type { SummarizationProvider } from './types';

// The exact shape PipelineHooks['summarize'] requires (data-model.md §1) —
// main.ts wires pipelineHooks.summarize = createSummarizeHook({...}) with no
// adapter of its own (contracts/summarization-api.md § hook.ts).
export interface SummarizeHookConfig {
	getProvider: () => SummarizationProvider | undefined; // undefined = not configured
	getCredential: () => string | undefined;
	notifyCredentialProblem: (message: string) => void; // FR-008
}

export function createSummarizeHook(
	config: SummarizeHookConfig,
): (input: SummarizationInput) => Promise<SummaryResult | undefined> {
	return async (input: SummarizationInput): Promise<SummaryResult | undefined> => {
		const provider = config.getProvider();
		if (provider === undefined) {
			return undefined;
		}

		const credential = config.getCredential();
		if (credential === undefined || credential.trim().length === 0) {
			return undefined;
		}

		// isUncited() gating owned here, not generate.ts (research.md §9,
		// contracts/summarization-api.md § hook.ts) — a future-directions call is
		// only attempted for a CONFIRMED-uncited paper.
		const wantFutureDirections = isUncited(input);

		const outcome = await runGeneration(input, provider, credential, wantFutureDirections);

		if (!outcome.ok) {
			if (outcome.reason === 'invalid-credentials') {
				config.notifyCredentialProblem(
					`Summarization credential was rejected (provider: ${provider.id}). ` +
						'Check the configured credential in settings.',
				);
			}
			// Every other failure reason (timeout, provider-error, empty-or-too-short)
			// is a silent abstract-fallback — never blocks note creation (FR-007/FR-012).
			return undefined;
		}

		return {
			summary: outcome.summary,
			// Not uncited -> '' (the 003 "not applicable" sentinel, research.md §2) —
			// no future-directions call was even attempted in that case, and
			// runGeneration() already degrades a requested-but-failed one to ''.
			futureDirections: outcome.futureDirections,
		};
	};
}
