import {
	type AuthProfileView,
	deleteProfileResponseSchema,
} from "@openmeld/schemas";
import { getRequestHeaders } from "@tanstack/react-start/server";
import {
	notifyLocalExecutionEvidenceChanged,
	warnLocalExecutionEvidenceRefreshFailed,
} from "#/lib/connect/local-execution-evidence-refresh.server";

export async function deleteStartAgentProfileFromAuth(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
	profileId: string;
	requestHeaders: Headers;
}): Promise<AuthProfileView> {
	const normalizedProfileId = input.profileId.trim();
	if (normalizedProfileId.length === 0) {
		throw new Error(
			"Invalid delete agent profile input: profileId is required."
		);
	}

	const headers = new Headers({
		accept: "application/json",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}

	const response = await (input.fetchImpl ?? fetch)(
		new URL(
			`/v1/profiles/${encodeURIComponent(normalizedProfileId)}`,
			input.authBaseUrl
		),
		{
			method: "DELETE",
			headers,
		}
	);
	if (!response.ok) {
		if (response.status === 404) {
			throw new Error("Agent Profile was already removed.");
		}
		throw new Error(`Failed to remove agent profile: ${response.status}`);
	}

	const payload = await response.json();
	const parsedResponse = deleteProfileResponseSchema.safeParse(payload);
	if (!parsedResponse.success) {
		throw new Error(
			`Invalid delete agent profile response: ${parsedResponse.error.message}`
		);
	}
	if (parsedResponse.data.profile.profileKind !== "agent") {
		throw new Error(
			"Invalid delete agent profile response: expected agent profile"
		);
	}

	return parsedResponse.data.profile;
}

export async function deleteStartAgentProfileFromRequest(input: {
	authBaseUrl: string;
	fetchImpl?: typeof fetch;
	gatewayUrl: string;
	profileId: string;
	requestHeaders?: Headers;
}): Promise<AuthProfileView> {
	const requestHeaders = input.requestHeaders ?? getRequestHeaders();
	let profile: AuthProfileView;
	try {
		profile = await deleteStartAgentProfileFromAuth({
			requestHeaders,
			authBaseUrl: input.authBaseUrl,
			fetchImpl: input.fetchImpl,
			profileId: input.profileId,
		});
	} catch (error) {
		if (!isAlreadyRemovedAgentProfileError(error)) {
			throw error;
		}
		// Binding disable and Space exits are server-owned consequences of the
		// auth delete now; the client only nudges the local evidence refresh.
		await notifyAgentProfileDeleted({
			fetchImpl: input.fetchImpl,
			gatewayUrl: input.gatewayUrl,
			profileId: input.profileId,
			requestHeaders,
		});
		throw error;
	}

	await notifyAgentProfileDeleted({
		fetchImpl: input.fetchImpl,
		gatewayUrl: input.gatewayUrl,
		profileId: profile.openMeldProfileId,
		requestHeaders,
	});
	return profile;
}

async function notifyAgentProfileDeleted(input: {
	fetchImpl?: typeof fetch;
	gatewayUrl: string;
	profileId: string;
	requestHeaders: Headers;
}): Promise<void> {
	await notifyLocalExecutionEvidenceChanged({
		fetchImpl: input.fetchImpl,
		gatewayUrl: input.gatewayUrl,
		profileId: input.profileId,
		reason: "agent_profile_deleted",
		requestHeaders: input.requestHeaders,
	}).catch((error) => {
		warnLocalExecutionEvidenceRefreshFailed({
			error,
			profileId: input.profileId,
			reason: "agent_profile_deleted",
		});
	});
}

function isAlreadyRemovedAgentProfileError(error: unknown): boolean {
	return (
		error instanceof Error &&
		error.message.includes("Agent Profile was already removed.")
	);
}
