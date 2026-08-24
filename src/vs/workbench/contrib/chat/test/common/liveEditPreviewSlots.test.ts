/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	DialecticLiveEditSlotMap,
	dialecticLiveEditContextKey,
	dialecticLiveEditPane,
	dialecticLiveEditSourceId,
	liveEditPreviewPaneKey,
	liveEditPreviewUsesSplit,
} from '../../common/liveEditPreviewSlots.js';

suite('Dialectic live-edit slots', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('pins the first two sources to left and right panes', () => {
		const slots = new DialecticLiveEditSlotMap();
		assert.strictEqual(slots.slotFor('worker-a'), 0);
		assert.strictEqual(slots.slotFor('worker-b'), 1);
		assert.strictEqual(slots.slotFor('worker-a'), 0);
		assert.strictEqual(slots.slotFor('worker-c'), 0);
		slots.reset();
		assert.strictEqual(slots.slotFor('worker-c'), 0);
	});

	test('keeps assigned workers on stable panes instead of first-come files', () => {
		const slots = new DialecticLiveEditSlotMap();
		const workers = ['deepseek-harness', 'grok-build'];
		assert.strictEqual(dialecticLiveEditPane('grok-build', workers, slots), 1);
		assert.strictEqual(dialecticLiveEditPane('deepseek-harness', workers, slots), 0);
		assert.strictEqual(dialecticLiveEditPane('file://a.ts', workers, slots), 0);
		assert.strictEqual(dialecticLiveEditPane('file://b.ts', workers, slots), 1);
	});

	test('maps a file onto the worker that listed or produced it', () => {
		const tasks = [
			{ workerProviderId: 'deepseek-harness', files: ['src/left.ts'], changedFiles: [] },
			{ workerProviderId: 'grok-build', files: [], changedFiles: ['C:\\repo\\src\\right.ts'] },
		];
		assert.strictEqual(dialecticLiveEditSourceId('/repo/src/left.ts', tasks), 'deepseek-harness');
		assert.strictEqual(dialecticLiveEditSourceId('/repo/src/right.ts', tasks), 'grok-build');
		assert.strictEqual(dialecticLiveEditSourceId('/repo/src/other.ts', tasks), 'repo/src/other.ts');
	});

	test('keeps an orchestration run on one preview context', () => {
		assert.strictEqual(dialecticLiveEditContextKey('chat', 'run-1', 'req-9'), 'chat\0run-1');
		assert.strictEqual(dialecticLiveEditContextKey('chat', undefined, 'req-9'), 'chat\0req-9');
		assert.strictEqual(liveEditPreviewUsesSplit(0), true);
		assert.strictEqual(liveEditPreviewUsesSplit('diff'), false);
		assert.strictEqual(liveEditPreviewPaneKey(1), '1');
		assert.strictEqual(liveEditPreviewPaneKey(undefined), 'diff');
	});
});
