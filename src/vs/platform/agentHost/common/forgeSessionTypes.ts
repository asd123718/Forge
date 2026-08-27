/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CODEX_AGENT_PROVIDER_ID } from './agent.js';

/** Whether Forge should surface a session type in pickers and session lists. */
export function isForgeAdvertisedSessionTypeId(sessionTypeId: string): boolean {
	return sessionTypeId === CODEX_AGENT_PROVIDER_ID || sessionTypeId === 'agent-host-codex';
}
