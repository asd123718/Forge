/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { GrokBuildWorker, parseWorkerSummary, resolveDeepSeekCommand, resolveGrokCommand, workerPrompt } from '../../../node/orchestration/workerAdapters.js';
import type { IWorkerRunRequest } from '../../../common/orchestration/orchestrationTypes.js';

suite('Forge worker adapters', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses grok json output without treating the transcript as the summary', () => {
		const result = parseWorkerSummary(JSON.stringify({
			text: 'Changed src/a.ts. testsPassed true.',
			stopReason: 'end_turn',
			usage: { input_tokens: 10, output_tokens: 4, total_cost_usd: 0.02 },
			changedFiles: ['src/a.ts'],
			testsPassed: true,
		}), 0, Date.now() - 20);
		assert.strictEqual(result.status, 'completed');
		assert.ok(result.summary.includes('Changed src/a.ts'));
		assert.deepStrictEqual(result.changedFiles, ['src/a.ts']);
		assert.strictEqual(result.testsPassed, true);
		assert.strictEqual(result.usage?.inputTokens, 10);
		assert.strictEqual(result.usage?.costUsd, 0.02);
	});

	test('requires API keys or credential files before resolving worker CLIs', () => {
		const previousForgeHome = process.env.FORGE_HOME;
		process.env.FORGE_HOME = '/missing-forge-test-home';
		try {
			assert.strictEqual(resolveDeepSeekCommand('/missing-root', {}), undefined);
			assert.strictEqual(resolveGrokCommand('/missing-root', {}), undefined);
			const deepseek = resolveDeepSeekCommand('/missing-root', { DEEPSEEK_API_KEY: 'k' } as NodeJS.ProcessEnv);
			assert.ok(deepseek);
			assert.strictEqual(deepseek.command === 'pnpm' || deepseek.command === 'npx', true);
			const grok = resolveGrokCommand('/missing-root', { XAI_API_KEY: 'k' } as NodeJS.ProcessEnv);
			assert.ok(grok);
			assert.ok(grok.command.includes('grok') || grok.command.endsWith('xai-grok-pager.exe') || grok.command.endsWith('xai-grok-pager'));
			assert.strictEqual(resolveGrokCommand('/missing-root', { FORGE_GROK_SIGNED_IN: '1' } as NodeJS.ProcessEnv), undefined);
			assert.strictEqual(resolveDeepSeekCommand('/missing-root', { FORGE_DEEPSEEK_SIGNED_IN: '1' } as NodeJS.ProcessEnv), undefined);
		} finally {
			if (previousForgeHome === undefined) {
				delete process.env.FORGE_HOME;
			} else {
				process.env.FORGE_HOME = previousForgeHome;
			}
		}
	});

	test('worker prompt asks for a structured summary, not a transcript', () => {
		const prompt = workerPrompt({
			goal: 'Add a button',
			contract: 'Keep CSS tokens',
			workspace: '/tmp',
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			abort: new AbortController().signal,
			task: {
				id: 't1',
				title: 'UI',
				prompt: 'Add the button',
				files: ['src/ui.ts'],
				dependsOn: [],
				workerProviderId: 'grok-build',
				workerLabel: 'Grok Build',
				workerModel: 'grok-4.6',
				status: 'running',
				attempt: 1,
			},
		} satisfies IWorkerRunRequest);
		assert.ok(prompt.includes('structured summary'));
		assert.ok(prompt.includes('Preferred model: grok-4.6'));
		assert.ok(!prompt.includes('full chat history'));
	});

	test('Grok uses guarded auto permissions and reports CLI output as progress', async () => {
		let invokedArgs: readonly string[] = [];
		const updates: Array<{ thinking?: string; progress?: string }> = [];
		const worker = new GrokBuildWorker(async (_command, args, options) => {
			invokedArgs = args;
			options.onStdout?.('running tool\n');
			return { exitCode: 0, stdout: JSON.stringify({ status: 'completed', summary: 'done' }), stderr: '' };
		}, async () => ({ command: 'grok', prefixArgs: [], env: { XAI_API_KEY: 'test' } }), 'grok-4.6');
		const result = await worker.run({
			goal: 'test permissions',
			contract: '',
			workspace: process.cwd(),
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			abort: new AbortController().signal,
			hooks: { onProgress: update => updates.push(update) },
			task: {
				id: 'safe', title: 'Safe', prompt: 'work', files: [], dependsOn: [],
				workerProviderId: 'grok-build', workerLabel: 'Grok Build', status: 'running', attempt: 1,
			},
		});
		assert.strictEqual(result.status, 'completed');
		assert.ok(!invokedArgs.includes('--yolo'));
		assert.deepStrictEqual(invokedArgs.slice(invokedArgs.indexOf('--permission-mode'), invokedArgs.indexOf('--permission-mode') + 2), ['--permission-mode', 'auto']);
		assert.strictEqual(updates[0].thinking, undefined);
		assert.match(updates[0].progress ?? '', /running tool/);
	});
});
