"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	connectCurrentCenterAgentSlackWorkspace,
	disconnectCurrentCenterAgentSlackWorkspace,
	resolveCenterAgentErrorMessage,
} from "#/lib/organizations/center-agent";
import { resolveMessageChannelErrorMessage } from "#/lib/organizations/message-channels";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { resolveVisibleChannelsSlackOAuthResult } from "#/lib/organizations/slack-oauth-result";
import {
	centerAgentDesignationQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import {
	activeLarkPlatformRegistrationListQueryOptions,
	messageChannelListQueryOptions,
	messageChannelQueryKeys,
} from "#/query/organizations/message-channels";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { CenterAgentMessageChannelsSection } from "./center-agent-message-channels-section";
import { useCenterAgentRouteState } from "./center-agent-route-state";
import { LarkPlatformChannelDialog } from "./lark-platform-channel-dialog";
import { SlackOAuthResultSurface } from "./slack-oauth-result-surface";
import { useLarkPlatformChannelManagement } from "./use-lark-platform-channel-management";

export function OrganizationMessageChannelsPage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	return (
		<OrganizationMessageChannelsContent
			currentUserId={currentUserId}
			isPersonalWorkspace={currentOrganization.isPersonal === true}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
		/>
	);
}

function OrganizationMessageChannelsContent(input: {
	currentUserId: string;
	isPersonalWorkspace: boolean;
	organizationId: string;
	organizationName: string;
}) {
	const queryClient = useQueryClient();
	const { channelsSlackOAuthResult } = useCenterAgentRouteState();
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !input.isPersonalWorkspace,
			organizationId: input.organizationId,
			userId: input.currentUserId,
		})
	);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: input.organizationId,
		})
	);
	const channelsQuery = useQuery(
		messageChannelListQueryOptions({
			organizationId: input.organizationId,
		})
	);
	const activeRegistrationsQuery = useQuery(
		activeLarkPlatformRegistrationListQueryOptions({
			organizationId: input.organizationId,
			queryClient,
		})
	);
	const larkPlatform = useLarkPlatformChannelManagement({
		connections: channelsQuery.data?.connections ?? [],
		organizationId: input.organizationId,
	});
	const canManage =
		input.isPersonalWorkspace ||
		canManageOrganizationArea(roleQuery.data, {
			channel: ["connect"],
		});
	const invalidateChannels = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: centerAgentQueryKeys.designation(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: messageChannelQueryKeys.list(input.organizationId),
			}),
			queryClient.invalidateQueries({
				queryKey: messageChannelQueryKeys.activeRegistrations(
					input.organizationId
				),
			}),
		]);
	};
	const connectSlackMutation = useMutation({
		mutationFn: async (variables: { slackTeamId: string }) =>
			await connectCurrentCenterAgentSlackWorkspace({
				organizationId: input.organizationId,
				slackTeamId: variables.slackTeamId,
			}),
		onSuccess: async () => {
			await invalidateChannels();
			toast.success("Slack workspace connected.");
		},
	});
	const disconnectSlackMutation = useMutation({
		mutationFn: async () =>
			await disconnectCurrentCenterAgentSlackWorkspace({
				organizationId: input.organizationId,
			}),
		onSuccess: async () => {
			await invalidateChannels();
			toast.success("Slack disconnected.");
		},
	});
	const slackError =
		connectSlackMutation.error ?? disconnectSlackMutation.error;
	const slackOAuthResult = resolveVisibleChannelsSlackOAuthResult({
		result: channelsSlackOAuthResult,
		slackConnected: designationQuery.data?.slackConnection?.connected === true,
	});
	const channelsLoading = resolveChannelsLoading({
		channelsPending: channelsQuery.isPending,
		designationPending: designationQuery.isPending,
		isPersonalWorkspace: input.isPersonalWorkspace,
		rolePending: roleQuery.isPending,
	});
	const messageChannelError =
		channelsQuery.error ?? activeRegistrationsQuery.error;
	const pageIntroduction = resolveChannelsPageIntroduction({
		isPersonalWorkspace: input.isPersonalWorkspace,
		organizationName: input.organizationName,
	});
	return (
		<>
			<AppPageHeader
				description={pageIntroduction.description}
				descriptionWidth="full"
				eyebrow={pageIntroduction.eyebrow}
				title="Channels"
			/>
			<SlackOAuthResultSurface
				canManage={canManage}
				organizationName={input.organizationName}
				result={slackOAuthResult}
			/>
			{channelsLoading ? (
				<p className="text-muted-foreground text-sm">Loading channels.</p>
			) : null}
			{designationQuery.isError ||
			channelsQuery.isError ||
			activeRegistrationsQuery.isError ? (
				<p
					className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
					role="alert"
				>
					{messageChannelError
						? resolveMessageChannelErrorMessage(
								messageChannelError,
								"OpenMeld could not load this organization’s channels."
							)
						: resolveCenterAgentErrorMessage(
								designationQuery.error,
								"designation_read"
							)}
				</p>
			) : null}
			{designationQuery.data && channelsQuery.data ? (
				<CenterAgentMessageChannelsSection
					activeRegistrations={
						activeRegistrationsQuery.data?.registrations ?? []
					}
					activeRegistrationsChecking={activeRegistrationsQuery.isFetching}
					activeRegistrationsUnavailable={activeRegistrationsQuery.isError}
					availableProviders={channelsQuery.data.availableLarkPlatformProviders}
					canManage={canManage}
					connections={channelsQuery.data.connections}
					disableSlackConnect={connectSlackMutation.isPending}
					disableSlackDisconnect={disconnectSlackMutation.isPending}
					larkPlatformPendingProvider={larkPlatform.beginPendingProvider}
					managementMode={canManage ? "inline" : "read-only"}
					onConnectSlackWorkspace={(variables) =>
						connectSlackMutation.mutate(variables)
					}
					onDisconnectSlackWorkspace={() => disconnectSlackMutation.mutate()}
					onManageLarkPlatform={larkPlatform.manage}
					slackConnection={designationQuery.data.slackConnection}
				/>
			) : null}
			{!input.isPersonalWorkspace && roleQuery.isError ? (
				<p
					className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
					role="alert"
				>
					OpenMeld could not confirm whether you can manage these channels.
				</p>
			) : null}
			{slackError ? (
				<p
					className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
					role="alert"
				>
					{resolveCenterAgentErrorMessage(
						slackError,
						connectSlackMutation.error ? "slack_connect" : "slack_disconnect"
					)}
				</p>
			) : null}
			<LarkPlatformChannelDialog
				canManage={canManage}
				connection={larkPlatform.connection}
				disconnectPending={larkPlatform.disconnectPending}
				errorMessage={larkPlatform.errorMessage}
				onDisconnect={larkPlatform.disconnect}
				onOpenChange={larkPlatform.setOpen}
				onRepair={larkPlatform.repair}
				onRetryPoll={larkPlatform.retryPoll}
				onStartOver={larkPlatform.startOver}
				open={larkPlatform.open}
				pollPending={larkPlatform.pollPending}
				provider={larkPlatform.provider}
				registration={larkPlatform.registration}
				repairPending={larkPlatform.repairPending}
				startOverPending={larkPlatform.startOverPending}
			/>
		</>
	);
}

function resolveChannelsPageIntroduction(input: {
	isPersonalWorkspace: boolean;
	organizationName: string;
}): { description: string; eyebrow: string } {
	if (input.isPersonalWorkspace) {
		return {
			description:
				"Connect Slack, Lark, or Feishu so you can message your Center Agent and receive replies in the same conversation.",
			eyebrow: "Personal workspace",
		};
	}

	return {
		description: `Connect Slack, Lark, or Feishu so people in ${input.organizationName} can message the same Center Agent and receive replies in the same conversation.`,
		eyebrow: "Organization",
	};
}

function resolveChannelsLoading(input: {
	channelsPending: boolean;
	designationPending: boolean;
	isPersonalWorkspace: boolean;
	rolePending: boolean;
}): boolean {
	return [
		input.channelsPending,
		input.designationPending,
		!input.isPersonalWorkspace && input.rolePending,
	].some(Boolean);
}
