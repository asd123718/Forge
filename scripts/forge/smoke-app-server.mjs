#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..', '..');
const workspaceRoot = resolve(projectRoot, '..');
const candidates = [
	join(projectRoot, '.build', 'forge-codex-sdk', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
	join(projectRoot, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
];
const binary = process.env.CODEX_BIN || candidates.find(existsSync);
if (!binary) {
	throw new Error('Codex binary not found. Run stage-codex.ps1 or restore Forge dependencies.');
}

const child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
let stderr = '';
const pending = new Map();
let nextId = 1;
const eventCounts = new Map();
let resolveTurnCompleted;
const turnCompleted = new Promise(resolve => { resolveTurnCompleted = resolve; });

child.stderr.setEncoding('utf8');
child.stderr.on('data', chunk => { stderr += chunk; });
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf('\n');
		if (newline < 0) {
			break;
		}
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (!line) {
			continue;
		}
		const message = JSON.parse(line);
		if (typeof message.method === 'string') {
			eventCounts.set(message.method, (eventCounts.get(message.method) ?? 0) + 1);
			if (message.method === 'turn/completed') {
				resolveTurnCompleted(message.params);
			}
		}
		if (message.id !== undefined && pending.has(message.id)) {
			const { resolve, reject } = pending.get(message.id);
			pending.delete(message.id);
			if (message.error) {
				reject(new Error(message.error.message ?? JSON.stringify(message.error)));
			} else {
				resolve(message.result);
			}
		}
	}
});

function send(message) {
	child.stdin.write(`${JSON.stringify(message)}\n`);
}

function request(method, params) {
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		send({ id, method, params });
	});
}

const runTurn = process.argv.includes('--turn');
const timeout = setTimeout(() => {
	child.kill();
	throw new Error(`app-server smoke test timed out${stderr ? `: ${stderr.trim()}` : ''}`);
}, runTurn ? 150_000 : 15_000);

try {
	const initialized = await request('initialize', {
		clientInfo: { name: 'forge_smoke', title: 'Forge smoke test', version: '0.1.0' },
		capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null },
	});
	send({ method: 'initialized' });
	const account = await request('account/read', { refreshToken: false });
	const accountType = account?.account?.type ?? 'signed-out';
	const result = {
		appServer: 'ready',
		serverUserAgent: initialized?.serverInfo?.userAgent ?? initialized?.userAgent ?? 'unknown',
		accountType,
		requiresOpenaiAuth: account?.requiresOpenaiAuth ?? null,
	};
	if (runTurn) {
		const threadResponse = await request('thread/start', {
			cwd: join(workspaceRoot, 'forge'),
			approvalPolicy: 'never',
			sandbox: 'read-only',
			ephemeral: true,
		});
		const threadId = threadResponse.thread.id;
		const turnResponse = await request('turn/start', {
			threadId,
			input: [{ type: 'text', text: 'Reply with exactly FORGE_STREAM_OK. Do not use tools.', text_elements: [] }],
			effort: 'low',
			summary: 'concise',
		});
		const completed = await turnCompleted;
		result.turn = {
			started: Boolean(turnResponse?.turn?.id),
			completed: completed?.turn?.status ?? 'unknown',
			errorNotifications: eventCounts.get('error') ?? 0,
			agentMessageDeltas: eventCounts.get('item/agentMessage/delta') ?? 0,
			reasoningSummaryDeltas: eventCounts.get('item/reasoning/summaryTextDelta') ?? 0,
			toolItems: eventCounts.get('item/started') ?? 0,
		};
	}
	console.log(JSON.stringify(result, null, 2));
} finally {
	clearTimeout(timeout);
	child.kill();
}
