import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	RespondToSpaceAgentInteractionBody,
	RespondToSpaceAgentInteractionResponse,
} from "@openmeld/schemas/types";
import { createUnscopedWebSpaceApi } from "./api";
import { SPACE_AGENT_INTERACTION_RESPONSE_TIMEOUT_MS } from "./request-timeouts";

export function isAgentInteractionResponseUnconfirmed(error: unknown): boolean {
	const failure = toStructuredApiClientFailure(error);
	return (
		failure.code === "network.timeout" ||
		failure.code === "network.request_failed" ||
		failure.code === "gateway.invalid_response" ||
		(failure.status !== null && failure.status >= 500)
	);
}

export async function sendWebSpaceAgentInteractionResponse(input: {
	body: RespondToSpaceAgentInteractionBody;
	openMeldProfileId: string;
	spaceId: string;
}): Promise<void> {
	const api = createUnscopedWebSpaceApi({
		openMeldProfileId: input.openMeldProfileId,
	});
	const request = {
		body: input.body,
		spaceId: input.spaceId,
		timeoutMs: SPACE_AGENT_INTERACTION_RESPONSE_TIMEOUT_MS,
	};
	let response: RespondToSpaceAgentInteractionResponse;
	try {
		response = await api.respondToAgentInteraction(request);
	} catch (error) {
		if (!isAgentInteractionResponseUnconfirmed(error)) {
			throw error;
		}
		// Core's retained receipt confirms the exact same answer, even after
		// delivery. This does not create another approval or change its answer.
		response = await api.respondToAgentInteraction(request);
	}
	if (!response.ok) {
		throw new Error(response.message);
	}
}
