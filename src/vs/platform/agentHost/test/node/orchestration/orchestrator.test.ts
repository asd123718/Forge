/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { execFile } from 'child_process';
import { access, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from '../../../../../base/common/path.js';
import { timeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { AgentHostStateManager } from '../../../node/agentHostStateManager.js';
import { AgentConfigurationService } from '../../../node/agentConfigurationService.js';
import { ForgeOrchestrationService } from '../../../node/orchestration/orchestrator.js';
import type { ILeaderPlanContext, ILeaderProvider, IOrchestrationPlan, IWorkerAvailability, IWorkerProvider, IWorkerTaskResult } from '../../../common/orchestration/orchestrationTypes.js';

function runGit(cwd: string, args: readonly string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile('git', [...args], { cwd, windowsHide: true }, error => error ? reject(error) : resolve());
	});
}

class FakeLeader implements ILeaderProvider {
	readonly label: string;
	public reviews = 0;
	public implemented: string[] = [];
	constructor(
		private readonly _plan: IOrchestrationPlan,
		readonly id = 'codex',
	) {
		this.label = id;
	}
	async plan(): Promise<IOrchestrationPlan> { return this._plan; }
	async review(): Promise<string> {
		this.reviews++;
		return 'Looks good.';
	}
	async implement(task: { id: string }): Promise<IWorkerTaskResult> {
		this.implemented.push(task.id);
		return { status: 'completed', summary: 'leader patch', changedFiles: ['src/escalated.ts'], usage: { durationMs: 2 } };
	}
}

class FakeWorker implements IWorkerProvider {
	readonly defaultModel = 'test';
	constructor(
		readonly id: string,
		readonly label: string,
		private readonly _run: (prompt: string, workspace: string, abort: AbortSignal) => Promise<IWorkerTaskResult>,
		private readonly _available = true,
		private readonly _availabilityReason?: 'missing-credentials' | 'probe-failed',
	) { }
	async checkAvailability(): Promise<IWorkerAvailability> {
		return {
			available: this._available,
			reason: this._available ? undefined : (this._availabilityReason ?? 'invalid-runtime'),
		};
	}
	async isAvailable(): Promise<boolean> { return this._available; }
	async run(request: { task: { prompt: string }; workspace: string; abort: AbortSignal }): Promise<IWorkerTaskResult> {
		return this._run(request.task.prompt, request.workspace, request.abort);
	}
}

class PausingPlanLeader implements ILeaderProvider {
	readonly id = 'codex';
	readonly label = 'codex';
	public plans = 0;
	public reviews = 0;

	async plan(_context: ILeaderPlanContext, abort: AbortSignal): Promise<IOrchestrationPlan> {
		this.plans++;
		if (this.plans === 1) {
			await new Promise<void>(resolve => abort.addEventListener('abort', () => resolve(), { once: true }));
			throw new Error('planning interrupted');
		}
		return {
			summary: 'resumed plan',
			contract: '',
			tasks: [{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: [], workerHint: 'deepseek-harness' }],
		};
	}

	async review(): Promise<string> {
		this.reviews++;
		return 'Looks good.';
	}

	async implement(): Promise<IWorkerTaskResult> {
		return { status: 'failed', summary: '', changedFiles: [], error: 'not used', usage: { durationMs: 0 } };
	}
}

suite('Forge orchestration scheduler', () => {
	const disposables = new DisposableStore();

	teardown(() => disposables.clear());
	ensureNoDisposablesAreLeakedInTestSuite();

	function createService(): ForgeOrchestrationService {
		const log = new NullLogService();
		const state = disposables.add(new AgentHostStateManager(log));
		const config = disposables.add(new AgentConfigurationService(state, log));
		return disposables.add(new ForgeOrchestrationService(config, state, log, { appRoot: process.cwd() } as never));
	}

	async function tempWorkspace(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), 'forge-orch-'));
		await writeFile(join(dir, 'README.md'), '# Test workspace\n');
		await runGit(dir, ['init']);
		await runGit(dir, ['add', '--all']);
		await runGit(dir, ['-c', 'user.name=Forge Test', '-c', 'user.email=forge-test@invalid', 'commit', '--no-gpg-sign', '-m', 'initial']);
		disposables.add({ dispose: () => { void rm(dir, { recursive: true, force: true }); } });
		return dir;
	}

	test('runs two independent workers then asks the leader to review', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'parallel',
			contract: 'small patches',
			tasks: [
				{ id: 'a', title: 'A', prompt: 'do a', files: [], dependsOn: [], workerHint: 'deepseek-harness' },
				{ id: 'b', title: 'B', prompt: 'do b', files: [], dependsOn: [], workerHint: 'grok-build' },
			],
		});
		const seen: string[] = [];
		service.setLeader(leader);
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async () => {
			seen.push('deepseek');
			return { status: 'completed', summary: 'a done', changedFiles: ['a.ts'], usage: { durationMs: 5 } };
		}));
		service.registerWorker(new FakeWorker('grok-build', 'Grok Build', async () => {
			seen.push('grok');
			return { status: 'completed', summary: 'b done', changedFiles: ['b.ts'], usage: { durationMs: 7, costUsd: 0.01 } };
		}));

		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'Ship a small parallel change',
		});

		assert.deepStrictEqual(seen.sort(), ['deepseek', 'grok']);
		assert.strictEqual(run.status, 'completed');
		assert.strictEqual(run.tasks.length, 2);
		assert.ok(run.tasks.every(task => task.status === 'completed'));
		assert.strictEqual(leader.reviews, 1);
		assert.strictEqual(run.review, 'Looks good.');
		assert.ok((run.usage.costUsd ?? 0) >= 0.01);
	});

	test('escalates a twice-failed worker to the leader', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'one task',
			contract: '',
			tasks: [{ id: 'only', title: 'Only', prompt: 'fail', files: [], dependsOn: [], workerHint: 'deepseek-harness' }],
		});
		service.setLeader(leader);
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async () => ({
			status: 'failed',
			summary: '',
			changedFiles: [],
			error: 'boom',
			usage: { durationMs: 1 },
		})));
		service.registerWorker(new FakeWorker('grok-build', 'Grok Build', async () => ({
			status: 'completed', summary: '', changedFiles: [], usage: { durationMs: 0 },
		})));

		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'fix it',
		});

		assert.deepStrictEqual(leader.implemented, ['only']);
		assert.strictEqual(run.tasks[0].status, 'escalated');
		assert.strictEqual(run.status, 'completed');
	});

	test('cancel stops a queued run', async () => {
		const service = createService();
		let release!: () => void;
		const blocked = new Promise<void>(resolve => { release = resolve; });
		service.setLeader(new FakeLeader({
			summary: 'slow',
			contract: '',
			tasks: [
				{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: [], workerHint: 'deepseek-harness' },
				{ id: 'b', title: 'B', prompt: 'b', files: [], dependsOn: ['a'], workerHint: 'grok-build' },
			],
		}));
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async () => {
			await blocked;
			return { status: 'completed', summary: 'a', changedFiles: [], usage: { durationMs: 1 } };
		}));
		service.registerWorker(new FakeWorker('grok-build', 'Grok Build', async () => ({
			status: 'completed', summary: 'b', changedFiles: [], usage: { durationMs: 1 },
		})));
		const started = service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'cancel me',
		});
		await timeout(20);
		await service.command({ type: 'cancel' });
		release();
		const run = await started;
		assert.strictEqual(run.status, 'cancelled');
	});

	test('uses the assigned leader even when it is not Codex', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'deepseek leads',
			contract: '',
			tasks: [
				{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: [], workerHint: 'codex' },
				{ id: 'b', title: 'B', prompt: 'b', files: [], dependsOn: [], workerHint: 'grok-build' },
			],
		}, 'deepseek-harness');
		service.registerLeader(leader);
		service.registerWorker(new FakeWorker('codex', 'Codex', async () => ({
			status: 'completed', summary: 'a', changedFiles: ['a.ts'], usage: { durationMs: 1 },
		})));
		service.registerWorker(new FakeWorker('grok-build', 'Grok Build', async () => ({
			status: 'completed', summary: 'b', changedFiles: ['b.ts'], usage: { durationMs: 1 },
		})));
		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'rotate roles',
			assignment: {
				leader: { providerId: 'deepseek-harness', label: 'DeepSeek Harness', role: 'leader' },
				workers: [
					{ providerId: 'codex', label: 'Codex', role: 'worker' },
					{ providerId: 'grok-build', label: 'Grok Build', role: 'worker' },
				],
			},
		});
		assert.strictEqual(run.assignment.leader.providerId, 'deepseek-harness');
		assert.strictEqual(leader.reviews, 1);
		assert.ok(run.tasks.some(task => task.workerProviderId === 'codex'));
		assert.ok(run.tasks.some(task => task.workerProviderId === 'grok-build'));
	});

	test('falls back to Codex when an assigned CLI worker is unavailable', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'parallel',
			contract: 'small patches',
			tasks: [
				{ id: 'a', title: 'A', prompt: 'do a', files: [], dependsOn: [], workerHint: 'deepseek-harness' },
			],
		});
		service.setLeader(leader);
		service.registerWorker({
			id: 'deepseek-harness',
			label: 'DeepSeek Harness',
			defaultModel: 'deepseek-v4-flash',
			checkAvailability: async () => ({ available: false, credentialSource: 'none', reason: 'missing-credentials' }),
			isAvailable: async () => false,
			run: async () => ({ status: 'failed', summary: '', changedFiles: [], usage: { durationMs: 0 } }),
		});
		service.registerWorker(new FakeWorker('codex', 'Codex', async () => ({
			status: 'completed', summary: 'codex fallback', changedFiles: ['fallback.ts'], usage: { durationMs: 1 },
		})));

		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'Use codex fallback',
			mode: 'dialectic',
		});

		assert.strictEqual(run.status, 'completed');
		assert.strictEqual(run.tasks[0].requestedWorkerProviderId, 'deepseek-harness');
		assert.strictEqual(run.tasks[0].resolvedWorkerProviderId, 'codex');
		assert.strictEqual(run.tasks[0].workerProviderId, 'codex');
		assert.strictEqual(run.tasks[0].workerFallbackReason, 'missing-credentials');
		assert.strictEqual(run.tasks[0].status, 'completed');
	});

	test('logos mode runs the selected agent without a leader plan', async () => {
		const service = createService();
		let prompt = '';
		service.registerWorker(new FakeWorker('grok-build', 'Grok Build', async (text) => {
			prompt = text;
			return { status: 'completed', summary: 'done', changedFiles: ['x.ts'], usage: { durationMs: 3 } };
		}));
		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'Write the helper',
			mode: 'logos',
			assignment: {
				leader: { providerId: 'grok-build', label: 'Grok Build', model: 'grok-4.6', thinkingLevel: 'high', role: 'leader' },
				workers: [{ providerId: 'grok-build', label: 'Grok Build', model: 'grok-4.6', role: 'worker' }],
			},
		});
		assert.strictEqual(prompt, 'Write the helper');
		assert.strictEqual(run.status, 'completed');
		assert.strictEqual(run.tasks.length, 1);
		assert.strictEqual(run.tasks[0].workerProviderId, 'grok-build');
		assert.strictEqual(run.tasks[0].thinkingLevel, 'high');
	});

	test('does not merge partial edits from a failed worker', async () => {
		const service = createService();
		service.setLeader(new FakeLeader({
			summary: 'one task',
			contract: '',
			tasks: [{ id: 'partial', title: 'Partial', prompt: 'fail after edit', files: ['failed.txt'], dependsOn: [], workerHint: 'deepseek-harness' }],
		}));
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async (_prompt, workspace) => {
			await writeFile(join(workspace, 'failed.txt'), 'must not merge\n');
			return { status: 'failed', summary: '', changedFiles: ['failed.txt'], error: 'worker failed', usage: { durationMs: 1 } };
		}));
		const workspace = await tempWorkspace();
		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace,
			goal: 'keep failed edits isolated',
		});
		assert.strictEqual(run.status, 'completed');
		await assert.rejects(access(join(workspace, 'failed.txt')));
	});

	test('marks dependency cycles as failed instead of completed', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'cycle',
			contract: '',
			tasks: [
				{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: ['b'], workerHint: 'deepseek-harness' },
				{ id: 'b', title: 'B', prompt: 'b', files: [], dependsOn: ['a'], workerHint: 'grok-build' },
			],
		});
		service.setLeader(leader);
		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'reject cycle',
		});
		assert.strictEqual(run.status, 'failed');
		assert.ok(run.tasks.every(task => task.status === 'failed'));
		assert.match(run.tasks[0].error ?? '', /dependencies|cycle/i);
		assert.strictEqual(leader.reviews, 1);
	});

	test('pause aborts the active worker and resume runs the queued task', async function () {
		this.timeout(5_000);
		const service = createService();
		service.setLeader(new FakeLeader({
			summary: 'pause',
			contract: '',
			tasks: [{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: [], workerHint: 'deepseek-harness' }],
		}));
		let attempts = 0;
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async (_prompt, _workspace, abort) => {
			attempts++;
			if (attempts === 1) {
				await new Promise<void>(resolve => {
					if (abort.aborted) {
						resolve();
					} else {
						abort.addEventListener('abort', () => resolve(), { once: true });
					}
				});
			}
			return { status: 'completed', summary: 'done', changedFiles: [], usage: { durationMs: 1 } };
		}));
		const started = service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'pause and resume',
		});
		while (attempts !== 1) {
			await timeout(10);
		}
		await service.command({ type: 'pause' });
		assert.strictEqual((await started).status, 'paused');
		assert.strictEqual(service.state?.tasks[0].status, 'queued');
		await service.command({ type: 'resume' });
		assert.strictEqual(service.state?.status, 'completed');
		assert.strictEqual(service.state?.tasks[0].status, 'completed');
		assert.strictEqual(attempts, 2);
	});

	test('pause during planning restarts planning on resume', async function () {
		this.timeout(5_000);
		const service = createService();
		const leader = new PausingPlanLeader();
		service.setLeader(leader);
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async () => ({
			status: 'completed', summary: 'done', changedFiles: [], usage: { durationMs: 1 },
		})));
		const started = service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'pause planning',
		});
		while (leader.plans !== 1) {
			await timeout(10);
		}
		await service.command({ type: 'pause' });
		assert.strictEqual((await started).status, 'paused');
		await service.command({ type: 'resume' });
		assert.strictEqual(service.state?.status, 'completed');
		assert.strictEqual(service.state?.tasks[0].status, 'completed');
		assert.strictEqual(leader.plans, 2);
		assert.strictEqual(leader.reviews, 1);
	});

	test('a failed leader review terminates the run instead of leaving it reviewing', async () => {
		const service = createService();
		const leader = new FakeLeader({
			summary: 'review failure',
			contract: '',
			tasks: [{ id: 'a', title: 'A', prompt: 'a', files: [], dependsOn: [], workerHint: 'deepseek-harness' }],
		});
		leader.review = async () => { throw new Error('review unavailable'); };
		service.setLeader(leader);
		service.registerWorker(new FakeWorker('deepseek-harness', 'DeepSeek Harness', async () => ({
			status: 'completed', summary: 'done', changedFiles: [], usage: { durationMs: 1 },
		})));
		const run = await service.start({
			chatUri: 'ahp-chat://x/default',
			sessionUri: 'codex://x',
			workspace: await tempWorkspace(),
			goal: 'handle review failure',
		});
		assert.strictEqual(run.status, 'failed');
		assert.match(run.error ?? '', /review unavailable/);
	});
});
