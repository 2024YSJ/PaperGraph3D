import { App, Modal, Notice, Setting } from 'obsidian';
import type { EmbeddingDiagnostics } from '../collection/localTransformer';

// Shows the measured embedding-runtime numbers. A modal rather than the developer
// console because the plugin guidelines forbid console logging (AGENTS.md), and a
// Notice cannot hold a readable table — and unlike console output, this can be copied
// out of a normal Obsidian window by a user who is reporting an environment.

function round(value: number): number {
	return Math.round(value * 10) / 10;
}

function copiedNotice(): string {
	return 'PaperGraph3D: 진단 결과를 복사했습니다.\nDiagnostics copied.';
}

export class EmbeddingDiagnosticsModal extends Modal {
	private readonly diagnostics: EmbeddingDiagnostics;

	constructor(app: App, diagnostics: EmbeddingDiagnostics) {
		super(app);
		this.diagnostics = diagnostics;
	}

	private summary(): string {
		const d = this.diagnostics;
		const mean = d.perPaperMs.reduce((a, b) => a + b, 0) / d.perPaperMs.length;
		const lines = [
			`crossOriginIsolated : ${d.crossOriginIsolated}`,
			`numThreads          : ${d.numThreads ?? '(unset)'}`,
			`wasmPaths           : ${d.wasmPaths}`,
			'',
			`init                : ${round(d.initMs)} ms`,
			`per paper           : ${d.perPaperMs.map(round).join(' / ')} ms`,
			`mean                : ${round(mean)} ms`,
			`1,000 papers        : ${round((mean * 1000) / 60000)} min`,
			'',
			`dimension           : ${d.dimension}  (expected 768)`,
			`related cosine      : ${d.relatedCosine.toFixed(4)}  (Python ref 0.9331)`,
			`unrelated cosine    : ${d.unrelatedCosine.toFixed(4)}  (Python ref 0.8874)`,
		];
		return lines.join('\n');
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Embedding runtime diagnostics' });

		const d = this.diagnostics;
		// The cosines are the only pass/fail here: they say whether this runtime
		// reproduces the model's intended use. Fast but wrong numbers are worse than slow
		// ones, so the verdict goes above the timings rather than below them.
		const correct =
			d.dimension === 768 &&
			Math.abs(d.relatedCosine - 0.9331) < 0.02 &&
			Math.abs(d.unrelatedCosine - 0.8874) < 0.02;
		contentEl.createEl('p', {
			text: correct
				? '벡터가 파이썬 기준과 일치합니다 — 런타임이 정상입니다. / Vectors match the Python reference: the runtime is correct.'
				: '벡터가 파이썬 기준과 다릅니다 — 토크나이징이나 풀링이 어긋났을 수 있습니다. / Vectors diverge from the Python reference: tokenization or pooling may be wrong.',
		});

		contentEl.createEl('pre', { text: this.summary() });

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText('Copy')
				.setCta()
				.onClick(() => {
					void navigator.clipboard.writeText(this.summary()).then(() => {
						new Notice(copiedNotice());
					});
				}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
