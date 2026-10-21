import { notifyAgentProfileRouteCatalogChangedResponseSchema } from "@openmeld/schemas";
import {
	applyOpenMeldGatewayClientAddress,
	resolveOpenMeldGatewayUpstream,
} from "#/lib/openmeld-api/gateway-upstream";

export type LocalExecutionEvidenceChangedReason =
	| "agent_profile_binding_changed"
	| "agent_profile_deleted";

export async function notifyLocalExecutionEvidenceChanged(input: {
	fetchImpl?: typeof fetch;
	gatewayUrl: string;
	profileId: string;
	reason: LocalExecutionEvidenceChangedReason;
	requestHeaders: Headers;
}): Promise<void> {
	const normalizedProfileId = input.profileId.trim();
	if (!normalizedProfileId) {
		throw new Error(
			"Invalid local execution evidence refresh input: profileId is required."
		);
	}

	const headers = new Headers({
		accept: "application/json",
		"content-type": "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	for (const name of ["origin", "referer"] as const) {
		const value = input.requestHeaders.get(name);
		if (value !== null) {
			headers.set(name, value);
		}
	}

	const gatewayUpstream = await resolveOpenMeldGatewayUpstream({
		fetchImpl: input.fetchImpl,
	});
	applyOpenMeldGatewayClientAddress({
		upstream: gatewayUpstream,
		requestHeaders: input.requestHeaders,
		upstreamHeaders: headers,
	});
	const response = await gatewayUpstream.fetch(
		new URL("/v1/agent-profiles/route-catalog-sync", input.gatewayUrl),
		{
			method: "POST",
			// Keep the forwarded session cookie on the intended Gateway request.
			// The non-OK check below rejects a redirect without following it.
			redirect: "manual",
			headers,
			body: JSON.stringify({
				agentProfileIds: [normalizedProfileId],
				reason: input.reason,
			}),
		}
	);
	if (!response.ok) {
		throw new Error(
			`Failed to notify local execution evidence refresh: ${response.status}`
		);
	}

	const parsed = notifyAgentProfileRouteCatalogChangedResponseSchema.safeParse(
		await response.json()
	);
	if (!parsed.success) {
		throw new Error(
			`Invalid local execution evidence refresh response: ${parsed.error.message}`
		);
	}
}

export function warnLocalExecutionEvidenceRefreshFailed(input: {
	error: unknown;
	profileId: string;
	reason: LocalExecutionEvidenceChangedReason;
}): void {
	console.warn("[web.local_execution_evidence_refresh.notify_failed]", {
		event: "web.local_execution_evidence_refresh.notify_failed",
		error: toErrorMessage(input.error),
		profileId: input.profileId,
		reason: input.reason,
	});
}

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
