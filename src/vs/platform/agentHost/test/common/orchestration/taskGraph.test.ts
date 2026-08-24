/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { fallbackOrchestrationPlan, parseOrchestrationPlan, readyTaskIds } from '../../../common/orchestration/taskGraph.js';
import { isOrchestrationRequest, readAssignment } from '../../../common/orchestration/orchestrationTypes.js';

suite('Forge orchestration task graph', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses a fenced leader plan and keeps parallel tasks ready', () => {
		const plan = parseOrchestrationPlan(`
Here is the DAG:

\`\`\`json
{
  "summary": "Split UI and API",
  "contract": "Match existing CSS. Keep src/api public.",
  "tasks": [
    { "id": "api", "title": "API types", "prompt": "Add types", "files": ["src/api.ts"], "dependsOn": [], "workerHint": "deepseek-harness" },
    { "id": "ui", "title": "UI", "prompt": "Add view", "files": ["src/ui.ts"], "dependsOn": [], "workerHint": "grok-build" }
  ]
}
\`\`\`
`);
		assert.ok(plan);
		assert.strictEqual(plan.tasks.length, 2);
		assert.deepStrictEqual(readyTaskIds(plan.tasks, new Set()), ['api', 'ui']);
	});

	test('blocks dependents until prerequisites complete', () => {
		const plan = fallbackOrchestrationPlan('ship the feature', ['deepseek-harness', 'grok-build']);
		assert.strictEqual(plan.tasks.length, 2);
		assert.deepStrictEqual(readyTaskIds(plan.tasks, new Set()), ['discover', 'implement']);
		const chained = {
			summary: '',
			contract: '',
			tasks: [
				{ id: 'a', title: 'a', prompt: 'a', files: [], dependsOn: [] },
				{ id: 'b', title: 'b', prompt: 'b', files: [], dependsOn: ['a'] },
			],
		};
		assert.deepStrictEqual(readyTaskIds(chained.tasks, new Set()), ['a']);
		assert.deepStrictEqual(readyTaskIds(chained.tasks, new Set(['a'])), ['b']);
	});

	test('reads a user assignment without requiring hardcoded models', () => {
		const assignment = readAssignment({
			leader: { providerId: 'grok-build', label: 'Grok Build', model: 'grok-4.6' },
			workers: [{ providerId: 'codex', label: 'Codex' }, { providerId: 'deepseek-harness', label: 'DeepSeek Harness' }],
		});
		assert.strictEqual(assignment?.leader.role, 'leader');
		assert.strictEqual(assignment?.leader.providerId, 'grok-build');
		assert.strictEqual(assignment?.workers[0].providerId, 'codex');
		assert.strictEqual(isOrchestrationRequest({ goal: 'x', workspace: '/tmp' }), true);
		assert.strictEqual(isOrchestrationRequest({ consumed: 'x' }), false);
	});

	test('parses a grok json envelope without treating the wrapper as the plan', () => {
		const plan = parseOrchestrationPlan(JSON.stringify({
			text: '```json\n{"summary":"ok","contract":"small","tasks":[{"id":"t1","title":"A","prompt":"do","files":[],"dependsOn":[]}]}\n```',
			usage: { input_tokens: 1 },
		}));
		assert.ok(plan);
		assert.strictEqual(plan.summary, 'ok');
		assert.strictEqual(plan.tasks[0].id, 't1');
	});
});
