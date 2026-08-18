/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { buildStreamingEditAnimation, buildStreamingEditFrames } from '../../browser/streamingEditPreview.js';

suite('StreamingEditPreview', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('writes a newly created file one line at a time', () => {
		const frames = buildStreamingEditFrames('', 'first\nsecond\nthird');
		assert.deepStrictEqual(frames.map(frame => frame.content), [
			'first',
			'first\nsecond',
			'first\nsecond\nthird',
		]);
		assert.deepStrictEqual(frames.map(frame => frame.activeLine), [0, 1, 2]);
		assert.ok(frames.every(frame => !frame.zip));
	});

	test('preserves unchanged prefix and suffix while replacing lines', () => {
		const frames = buildStreamingEditFrames(
			'const before = true;\nold one\nold two\nexport {};',
			'const before = true;\nnew one\nnew two\nexport {};',
		);
		assert.strictEqual(frames[0].content, 'const before = true;\nold one\nold two\nexport {};');
		assert.strictEqual(frames.at(-1)?.content, 'const before = true;\nnew one\nnew two\nexport {};');
		assert.strictEqual(frames[0].zip, true);
		assert.ok(frames.slice(1, -1).some(frame => !frame.zip));
	});

	test('animates deletions and converges exactly including trailing newline', () => {
		const target = 'keep\nlast\n';
		const frames = buildStreamingEditFrames('keep\nremove one\nremove two\nlast\n', target);
		assert.ok(frames.length > 1);
		assert.strictEqual(frames.at(-1)?.content, target);
	});

	test('coalesces very large changes into a bounded number of frames', () => {
		const target = Array.from({ length: 1_000 }, (_, index) => `line ${index}`).join('\n');
		const frames = buildStreamingEditFrames('', target);
		assert.ok(frames.length <= 200);
		assert.strictEqual(frames.at(-1)?.content, target);
	});

	test('slows at multiple hunks and exposes the first changed line', () => {
		const original = ['same 0', 'old 1', ...Array.from({ length: 30 }, (_, index) => `same ${index + 2}`), 'old 32'].join('\n');
		const modified = ['same 0', 'new 1', ...Array.from({ length: 30 }, (_, index) => `same ${index + 2}`), 'new 32'].join('\n');
		const animation = buildStreamingEditAnimation(original, modified);
		assert.strictEqual(animation.firstChangedLine, 1);
		assert.ok(animation.frames.some(frame => frame.zip));
		assert.ok(animation.frames.filter(frame => !frame.zip).length >= 2);
		assert.strictEqual(animation.frames.at(-1)?.content, modified);
	});
});
