const PREFIX = "openmeld:agent-creation-intent:v1";

export type AgentCreationIntent = {
	customWorkspacePath?: string;
	fingerprint: string;
	idempotencyKey: string;
	profileName: string;
};

function storageKey(scope: string, organizationId: string): string {
	return `${PREFIX}:${scope}:${organizationId}`;
}

export function readAgentCreationIntent(
	scope: string,
	organizationId: string
): AgentCreationIntent | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const raw = window.sessionStorage.getItem(
			storageKey(scope, organizationId)
		);
		if (!raw) {
			return null;
		}
		const value: unknown = JSON.parse(raw);
		if (
			typeof value === "object" &&
			value !== null &&
			"fingerprint" in value &&
			"idempotencyKey" in value &&
			"profileName" in value &&
			typeof value.fingerprint === "string" &&
			typeof value.idempotencyKey === "string" &&
			typeof value.profileName === "string"
		) {
			return {
				customWorkspacePath:
					"customWorkspacePath" in value &&
					typeof value.customWorkspacePath === "string"
						? value.customWorkspacePath
						: undefined,
				fingerprint: value.fingerprint,
				idempotencyKey: value.idempotencyKey,
				profileName: value.profileName,
			};
		}
		window.sessionStorage.removeItem(storageKey(scope, organizationId));
	} catch {
		// Storage is optional. Core still deduplicates requests with the same key.
	}
	return null;
}

export function rememberAgentCreationIntent(
	input: AgentCreationIntent & {
		organizationId: string;
		scope: string;
	}
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.sessionStorage.setItem(
			storageKey(input.scope, input.organizationId),
			JSON.stringify({
				customWorkspacePath: input.customWorkspacePath,
				fingerprint: input.fingerprint,
				idempotencyKey: input.idempotencyKey,
				profileName: input.profileName,
			})
		);
	} catch {
		// The in-memory key still covers retries in this page visit.
	}
}

export function clearAgentCreationIntent(input: {
	idempotencyKey: string;
	organizationId: string;
	scope: string;
}): void {
	if (
		readAgentCreationIntent(input.scope, input.organizationId)
			?.idempotencyKey !== input.idempotencyKey
	) {
		return;
	}
	try {
		window.sessionStorage.removeItem(
			storageKey(input.scope, input.organizationId)
		);
	} catch {
		// A stale retry pointer is safe: Core returns the existing request.
	}
}
