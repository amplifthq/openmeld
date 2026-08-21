import {
	createCenterAgentApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	CenterAgentModelConfigurationResponse,
	CenterAgentModelPreference,
	CenterAgentSlackWorkspaceConnectionResponse,
	CenterAgentSlackWorkspaceDisconnectResponse,
	CenterAgentUpdateProfileResponse,
	DesignateCenterAgentResponse,
	GetCenterAgentDesignationResponse,
	GetCenterAgentDirectMessageSpaceProjectionResponse,
	GetCenterAgentOperatingStateResponse,
	ListCenterAgentAuditJournalResponse,
	OpenCenterAgentDirectMessageSpaceResponse,
	SlackIdentityLinkConsumeResponse,
	SlackIdentityLinkPreviewResponse,
	UpdateCenterAgentModelResponse,
	UpdateCenterAgentOperatingStateResponse,
} from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";
import {
	createOrganizationScopedWebOpenMeldApiFoundation,
	createUnscopedWebOpenMeldApiFoundation,
} from "#/lib/openmeld-api/client";

export type CenterAgentFailure = StructuredApiClientFailure;

type OpenCenterAgentDirectMessageSpaceInput = {
	organizationId: string;
	signal?: AbortSignal;
};

const openCurrentCenterAgentDirectMessageSpaceImpl = createIsomorphicFn()
	.client(
		async (
			input: OpenCenterAgentDirectMessageSpaceInput
		): Promise<OpenCenterAgentDirectMessageSpaceResponse> =>
			await createWebCenterAgentApi(
				input.organizationId
			).openDirectMessageSpace({
				...(input.signal === undefined ? {} : { signal: input.signal }),
			})
	)
	.server(
		async (
			input: OpenCenterAgentDirectMessageSpaceInput
		): Promise<OpenCenterAgentDirectMessageSpaceResponse> => {
			const { openCenterAgentDirectMessageSpaceFromRequest } = await import(
				"./center-agent-direct-message.server"
			);

			return await openCenterAgentDirectMessageSpaceFromRequest({
				...(input.signal === undefined ? {} : { signal: input.signal }),
				organizationId: input.organizationId,
				webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
			});
		}
	);

const readCurrentCenterAgentDirectMessageSpaceProjectionImpl =
	createIsomorphicFn()
		.client(
			async (
				input: OpenCenterAgentDirectMessageSpaceInput
			): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> =>
				await createWebCenterAgentApi(
					input.organizationId
				).getDirectMessageSpaceProjection({
					...(input.signal === undefined ? {} : { signal: input.signal }),
				})
		)
		.server(
			async (
				input: OpenCenterAgentDirectMessageSpaceInput
			): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> => {
				const { readCenterAgentDirectMessageSpaceProjectionFromRequest } =
					await import("./center-agent-direct-message.server");

				return await readCenterAgentDirectMessageSpaceProjectionFromRequest({
					...(input.signal === undefined ? {} : { signal: input.signal }),
					organizationId: input.organizationId,
					webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
				});
			}
		);

export type CenterAgentMutationKind =
	| "designation_read"
	| "designate"
	| "model_read"
	| "model_update"
	| "operating_state_read"
	| "operating_state_update"
	| "dm_open"
	| "dm_projection_read"
	| "audit_list"
	| "slack_connect"
	| "slack_disconnect"
	| "slack_link_preview"
	| "slack_link_consume"
	| "profile_update";

export async function readCurrentCenterAgentDesignation(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<GetCenterAgentDesignationResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).getDesignation({
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function designateCurrentCenterAgent(input: {
	agentProfileId?: string;
	organizationId: string;
	runtime?: "remote_agent" | "self_hosted";
}): Promise<DesignateCenterAgentResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).designate({
			...(input.agentProfileId === undefined
				? {}
				: { agentProfileId: input.agentProfileId }),
			...(input.runtime === undefined ? {} : { runtime: input.runtime }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentCenterAgentOperatingState(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<GetCenterAgentOperatingStateResponse> {
	try {
		return await createWebCenterAgentApi(
			input.organizationId
		).getOperatingState({
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentCenterAgentModel(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<CenterAgentModelConfigurationResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).getModel({
			...(input.signal === undefined ? {} : { signal: input.signal }),
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateCurrentCenterAgentModel(input: {
	expectedConfigurationRevision: number;
	organizationId: string;
	preference: CenterAgentModelPreference;
}): Promise<UpdateCenterAgentModelResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).updateModel({
			expectedConfigurationRevision: input.expectedConfigurationRevision,
			preference: input.preference,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateCurrentCenterAgentOperatingState(input: {
	operatingState: "active" | "paused";
	organizationId: string;
}): Promise<UpdateCenterAgentOperatingStateResponse> {
	try {
		return await createWebCenterAgentApi(
			input.organizationId
		).updateOperatingState({
			operatingState: input.operatingState,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function connectCurrentCenterAgentSlackWorkspace(input: {
	organizationId: string;
	slackTeamId: string;
}): Promise<CenterAgentSlackWorkspaceConnectionResponse> {
	try {
		return await createWebCenterAgentApi(
			input.organizationId
		).connectSlackWorkspace({
			slackTeamId: input.slackTeamId,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function disconnectCurrentCenterAgentSlackWorkspace(input: {
	organizationId: string;
}): Promise<CenterAgentSlackWorkspaceDisconnectResponse> {
	try {
		return await createWebCenterAgentApi(
			input.organizationId
		).disconnectSlackWorkspace();
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function previewSlackIdentityLink(input: {
	token: string;
}): Promise<SlackIdentityLinkPreviewResponse> {
	try {
		return await createUnscopedWebCenterAgentApi().previewSlackIdentityLink(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function consumeSlackIdentityLink(input: {
	includeReturnTarget?: true;
	token: string;
}): Promise<SlackIdentityLinkConsumeResponse> {
	try {
		return await createUnscopedWebCenterAgentApi().consumeSlackIdentityLink(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateCurrentCenterAgentProfile(input: {
	organizationId: string;
	profileName: string;
}): Promise<CenterAgentUpdateProfileResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).updateProfile({
			profileName: input.profileName,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentCenterAgentAuditJournal(input: {
	limit?: number;
	organizationId: string;
	signal?: AbortSignal;
}): Promise<ListCenterAgentAuditJournalResponse> {
	try {
		return await createWebCenterAgentApi(input.organizationId).listAuditJournal(
			{
				actionSet: "v19",
				...(input.limit === undefined ? {} : { limit: input.limit }),
				...(input.signal === undefined ? {} : { signal: input.signal }),
			}
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function openCurrentCenterAgentDirectMessageSpace(
	input: OpenCenterAgentDirectMessageSpaceInput
): Promise<OpenCenterAgentDirectMessageSpaceResponse> {
	try {
		return await openCurrentCenterAgentDirectMessageSpaceImpl(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readCurrentCenterAgentDirectMessageSpaceProjection(
	input: OpenCenterAgentDirectMessageSpaceInput
): Promise<GetCenterAgentDirectMessageSpaceProjectionResponse> {
	try {
		return await readCurrentCenterAgentDirectMessageSpaceProjectionImpl(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveCenterAgentErrorMessage(
	error: unknown,
	kind: CenterAgentMutationKind
): string {
	const failure = toStructuredApiClientFailure(error);
	const message = resolveCenterAgentErrorMessageWithoutDiagnostics(
		failure,
		kind
	);
	if (kind !== "designation_read" && kind !== "dm_open") {
		return message;
	}
	return appendCenterAgentDiagnostics(message, failure, kind);
}

export function isCenterAgentModelConfigurationChanged(
	error: unknown
): boolean {
	const failure = toStructuredApiClientFailure(error);
	return (
		(failure.upstreamCode ?? failure.code) ===
		"center_agent.model_configuration_changed"
	);
}

function resolveCenterAgentErrorMessageWithoutDiagnostics(
	failure: CenterAgentFailure,
	kind: CenterAgentMutationKind
): string {
	if (kind === "dm_open" && failure.code === "center_agent.dm_open_failed") {
		return "OpenMeld could not open the Center Agent conversation.";
	}
	const code = failure.upstreamCode ?? failure.code;

	switch (code) {
		case "message_channel.organization_required":
			return "Create an organization before connecting Slack, Lark, or Feishu.";
		case "slack.workspace_already_bound":
			return "That Slack workspace is already connected to another OpenMeld organization.";
		case "slack.organization_already_bound":
			return "This organization is already connected to a Slack workspace. Disconnect it before connecting another workspace.";
		case "slack.workspace_not_connected":
			return "That Slack workspace is no longer connected to OpenMeld.";
		case "slack.identity_link_token_invalid":
			return "This setup link has expired. Return to the original Slack thread and ask the Center Agent for a new setup button. You do not need to repeat your request.";
		case "slack.identity_link_account_required":
			return "You signed in with a different OpenMeld account. Sign out, sign in to your own OpenMeld account, then open the button again.";
		case "slack.identity_link_membership_required":
			return "This OpenMeld account is no longer a member of the organization connected to that Slack workspace. Return to Slack and ask the Center Agent for a new connection button.";
		case "slack.identity_already_linked":
			return "That Slack account is already linked to another OpenMeld member.";
		case "center_agent.profile_invalid":
			return "OpenMeld could not use that profile as the Center Agent. Refresh the page and try again.";
		case "center_agent.profile_not_found":
			return "OpenMeld could not find that Agent Profile. Refresh the directory and try again.";
		case "center_agent.profile_org_mismatch":
			return "Choose an Agent Profile this organization can Wake.";
		case "center_agent.designation_required":
			return "This organization does not have a Center Agent yet.";
		case "center_agent.designation_store_unavailable":
			return "OpenMeld could not read the Center Agent designation right now. Try again.";
		case "center_agent.designation_not_ready":
			return "The connection is still settling. Try connecting again in a moment.";
		case "center_agent.creator_required":
			return "Only the Organization creator can pause or resume the Center Agent.";
		case "center_agent.pause_incomplete":
			return "The Center Agent is paused, but OpenMeld could not stop every current task. Try pausing again or open diagnostics.";
		case "center_agent.model_configuration_changed":
			return "The Center Agent model changed somewhere else. Refresh this setting and try again.";
		case "center_agent.model_invalid":
			return "That Center Agent model cannot be used. Refresh this setting and choose another model.";
		case "remote_agent.runtime_disabled":
			return "Center Agent is currently turned off. Try again later.";
		case "remote_agent.organization_blocked":
			return "Center Agent is not available for this Organization.";
		case "center_agent.local_runtime_hidden":
			return "This Center Agent runs in OpenMeld and does not need a local computer.";
		default:
			break;
	}

	if (failure.status === 401) {
		return "Sign in again before managing the Center Agent.";
	}

	if (failure.status === 403) {
		return "Only organization owners and admins can manage the Center Agent.";
	}

	if (
		failure.code === "network.timeout" ||
		failure.code === "network.request_failed"
	) {
		return "OpenMeld could not reach the Center Agent service. Try again.";
	}

	switch (kind) {
		case "audit_list":
			return "OpenMeld could not load the Center Agent audit journal.";
		case "designation_read":
			return "OpenMeld could not load the Center Agent designation.";
		case "designate":
			return "OpenMeld could not update the Center Agent.";
		case "dm_open":
			return "OpenMeld could not open the Center Agent conversation.";
		case "dm_projection_read":
			return "OpenMeld could not load the Center Agent conversation.";
		case "model_read":
			return "OpenMeld could not load the Center Agent model.";
		case "model_update":
			return "OpenMeld could not update the Center Agent model.";
		case "operating_state_read":
			return "OpenMeld could not load the Center Agent operating state.";
		case "operating_state_update":
			return "OpenMeld could not change the Center Agent operating state.";
		case "slack_connect":
			return "OpenMeld could not connect Slack.";
		case "slack_disconnect":
			return "OpenMeld could not disconnect Slack.";
		case "slack_link_preview":
			return "OpenMeld could not open this Slack setup.";
		case "slack_link_consume":
			return "OpenMeld could not finish this Slack setup. Try again.";
		case "profile_update":
			return "OpenMeld could not update the Center Agent profile.";
		default:
			return "OpenMeld could not complete the Center Agent request.";
	}
}

function appendCenterAgentDiagnostics(
	message: string,
	failure: CenterAgentFailure,
	kind: "designation_read" | "dm_open"
): string {
	let diagnosticCode = failure.upstreamCode ?? failure.code;
	if (kind === "dm_open" && failure.code === "center_agent.dm_open_failed") {
		diagnosticCode = failure.upstreamCode
			? `${failure.code} / ${failure.upstreamCode}`
			: failure.code;
	}
	const requestId = failure.requestId?.trim() || null;
	return `${message} Error code: ${diagnosticCode}.${
		requestId ? ` Request ID: ${requestId}.` : ""
	}`;
}

function createWebCenterAgentApi(organizationId: string) {
	return createCenterAgentApi(
		createOrganizationScopedWebOpenMeldApiFoundation({ organizationId })
	);
}

function createUnscopedWebCenterAgentApi() {
	return createCenterAgentApi(createUnscopedWebOpenMeldApiFoundation());
}
