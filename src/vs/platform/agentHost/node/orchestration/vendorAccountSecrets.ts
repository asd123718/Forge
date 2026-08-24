/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const secrets = new Map<string, string>();

export function setVendorAccountSecret(id: string, value: string | undefined): void {
	if (value) {
		secrets.set(id, value);
	} else {
		secrets.delete(id);
	}
}

export function getVendorAccountSecret(id: string): string | undefined {
	return secrets.get(id);
}

export function providerSecretId(providerId: string): string {
	return `provider:${providerId}`;
}
