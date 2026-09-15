import { deletedAgentProfileActionResponseSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "#/env";
import { authBusinessRequest } from "#/lib/auth-business.server";
import {
	notifyLocalExecutionEvidenceChanged,
	warnLocalExecutionEvidenceRefreshFailed,
} from "#/lib/connect/local-execution-evidence-refresh.server";

export async function deleteAgentProfileRequest(
	request: Request,
	profileId: string
) {
	const response = await authBusinessRequest({
		request,
		upstreamPath: `/v1/profiles/agents/${encodeURIComponent(profileId)}`,
		responseSchema: deletedAgentProfileActionResponseSchema,
	});
	if (response.ok || response.status === 404) {
		await notifyLocalExecutionEvidenceChanged({
			gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
			profileId,
			requestHeaders: request.headers,
			reason: "agent_profile_deleted",
		}).catch((error) => {
			warnLocalExecutionEvidenceRefreshFailed({
				error,
				profileId,
				reason: "agent_profile_deleted",
			});
		});
	}
	return response;
}
export const Route = createFileRoute("/v1/profiles/agents/$profileId")({
	server: {
		handlers: {
			DELETE: ({ request, params }) =>
				deleteAgentProfileRequest(request, params.profileId),
		},
	},
});
