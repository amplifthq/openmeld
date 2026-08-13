import {
	createOrganizationApi,
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	LarkPlatformActiveRegistrationListResponse,
	LarkPlatformProvider,
	LarkPlatformRegistrationBeginMode,
	LarkPlatformRegistrationResponse,
	MessageChannelConnectionListResponse,
	MessageChannelIdentityLinkConsumeResponse,
	MessageChannelIdentityLinkPreviewResponse,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type MessageChannelFailure = StructuredApiClientFailure;

export async function listCurrentOrganizationMessageChannels(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<MessageChannelConnectionListResponse> {
	try {
		return await createMessageChannelApi(
			input.organizationId
		).listCurrentMessageChannels({ signal: input.signal });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function listCurrentOrganizationLarkPlatformRegistrations(input: {
	organizationId: string;
	signal?: AbortSignal;
}): Promise<LarkPlatformActiveRegistrationListResponse> {
	try {
		return await createMessageChannelApi(
			input.organizationId
		).listCurrentLarkPlatformRegistrations({ signal: input.signal });
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function previewMessageChannelIdentityLink(input: {
	token: string;
}): Promise<MessageChannelIdentityLinkPreviewResponse> {
	try {
		return await createUnscopedMessageChannelApi().previewMessageChannelIdentityLink(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function consumeMessageChannelIdentityLink(input: {
	token: string;
}): Promise<MessageChannelIdentityLinkConsumeResponse> {
	try {
		return await createUnscopedMessageChannelApi().consumeMessageChannelIdentityLink(
			input
		);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function beginCurrentOrganizationLarkPlatformRegistration(input: {
	mode?: LarkPlatformRegistrationBeginMode;
	organizationId: string;
	provider: LarkPlatformProvider;
	signal?: AbortSignal;
}): Promise<LarkPlatformRegistrationResponse> {
	try {
		return await createMessageChannelApi(
			input.organizationId
		).beginLarkPlatformRegistration({
			...(input.mode === undefined ? {} : { mode: input.mode }),
			provider: input.provider,
			signal: input.signal,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function pollCurrentOrganizationLarkPlatformRegistration(input: {
	attemptId: string;
	organizationId: string;
	provider: LarkPlatformProvider;
	signal?: AbortSignal;
}): Promise<LarkPlatformRegistrationResponse> {
	try {
		return await createMessageChannelApi(
			input.organizationId
		).pollLarkPlatformRegistration({
			attemptId: input.attemptId,
			provider: input.provider,
			signal: input.signal,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function disconnectCurrentOrganizationLarkPlatform(input: {
	organizationId: string;
	provider: LarkPlatformProvider;
	signal?: AbortSignal;
}): Promise<MessageChannelConnectionListResponse> {
	try {
		return await createMessageChannelApi(
			input.organizationId
		).disconnectLarkPlatform({
			provider: input.provider,
			signal: input.signal,
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveMessageChannelErrorMessage(
	error: unknown,
	fallback: string
): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.code) {
		case "message_channel.organization_required":
			return "Create an organization before connecting Slack, Lark, or Feishu.";
		case "message_channel.actor_required":
			return "Use a Human Profile to manage organization channels.";
		case "message_channel.already_connected":
			return "This channel is already connected. Refresh Channels to see its current status.";
		case "message_channel.connection_changed":
			return "This channel changed while you were managing it. Refresh Channels and try again.";
		case "message_channel.identity_already_linked":
			return "This Lark or Feishu account is already linked to another OpenMeld member.";
		case "message_channel.identity_link_account_required":
			return "You signed in with a different OpenMeld account. Sign out, sign in to your own OpenMeld account, then open the button again.";
		case "message_channel.identity_link_membership_required":
			return "This OpenMeld account is no longer a member of the Organization connected to this channel. Return to Lark or Feishu and ask the Center Agent for a new connection button.";
		case "message_channel.identity_link_token_invalid":
			return "This link has expired. Ask the Center Agent again in Lark or Feishu.";
		case "message_channel.provider_disabled":
			return "This channel is not enabled in the current environment yet.";
		case "message_channel.repair_unavailable":
			return "OpenMeld can no longer repair this saved app. Disconnect it, then connect again.";
		case "message_channel.registration_not_found":
			return "This setup session expired. Start the connection again.";
		case "message_channel.store_unavailable":
			return "Channel connection state is temporarily unavailable.";
		default:
			return failure.message || fallback;
	}
}

function createMessageChannelApi(organizationId: string) {
	return createOrganizationApi(
		createWebOpenMeldApiFoundation({ organizationId })
	);
}

function createUnscopedMessageChannelApi() {
	return createOrganizationApi(createWebOpenMeldApiFoundation());
}
