"use client";

import type { LarkPlatformProvider } from "@openmeld/schemas/types";
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
import { buildOrganizationNewOrganizationPath } from "#/lib/organizations/organization-routes";
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
import { PersonalWorkspaceChannelsGuidance } from "./personal-workspace-channels-guidance";
import { SlackOAuthResultSurface } from "./slack-oauth-result-surface";
import { useLarkPlatformChannelManagement } from "./use-lark-platform-channel-management";

const ignoreSlackConnect = (_input: { slackTeamId: string }) => undefined;
const ignoreSlackDisconnect = () => undefined;
const PERSONAL_WORKSPACE_CHANNEL_PROVIDERS = [
	"lark",
	"feishu",
] as const satisfies readonly LarkPlatformProvider[];

export function OrganizationMessageChannelsPage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	if (currentOrganization.isPersonal === true) {
		return (
			<PersonalWorkspaceMessageChannelsContent
				organizationId={currentOrganization.id}
				organizationName={currentOrganization.name}
				organizationSlug={currentOrganization.slug}
			/>
		);
	}
	return (
		<OrganizationMessageChannelsContent
			currentUserId={currentUserId}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			organizationSlug={currentOrganization.slug}
		/>
	);
}

function PersonalWorkspaceMessageChannelsContent(input: {
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
}) {
	const { channelsSlackOAuthResult } = useCenterAgentRouteState();
	const channelsQuery = useQuery(
		messageChannelListQueryOptions({ organizationId: input.organizationId })
	);
	const larkPlatform = useLarkPlatformChannelManagement({
		connections: channelsQuery.data?.connections ?? [],
		organizationId: input.organizationId,
	});
	const hasExistingSlackConnection = resolveHasExistingSlackConnection(
		channelsQuery.data?.connections
	);
	const slackOAuthResult = resolveVisibleChannelsSlackOAuthResult({
		result: channelsSlackOAuthResult,
		slackConnected: hasExistingSlackConnection,
	});
	return (
		<>
			<AppPageHeader
				description="Channels let you choose where to talk to your Agent."
				descriptionWidth="full"
				eyebrow="Personal workspace"
				title="Channels"
			/>
			<SlackOAuthResultSurface
				canManage={false}
				organizationName={input.organizationName}
				organizationSlug={input.organizationSlug}
				result={slackOAuthResult}
			/>
			<PersonalWorkspaceChannelsGuidance
				createOrganizationPath={buildOrganizationNewOrganizationPath(
					input.organizationSlug
				)}
				hasExistingSlackConnection={hasExistingSlackConnection}
			/>
			{channelsQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading channels.</p>
			) : null}
			<ChannelsLoadError
				channelsError={channelsQuery.error}
				designationError={undefined}
				fallback="OpenMeld could not load your Personal Workspace channels."
			/>
			{channelsQuery.data ? (
				<CenterAgentMessageChannelsSection
					availableProviders={PERSONAL_WORKSPACE_CHANNEL_PROVIDERS}
					canManage={false}
					connections={channelsQuery.data.connections}
					disableSlackConnect
					disableSlackDisconnect
					managementMode="cleanup"
					onConnectSlackWorkspace={ignoreSlackConnect}
					onDisconnectSlackWorkspace={ignoreSlackDisconnect}
					onManageLarkPlatform={larkPlatform.openExistingConnection}
					organizationRequired
					organizationSlug={input.organizationSlug}
				/>
			) : null}
			<LarkPlatformChannelDialog
				canManage
				cleanupOnly
				connection={larkPlatform.connection}
				disconnectPending={larkPlatform.disconnectPending}
				errorMessage={larkPlatform.errorMessage}
				onDisconnect={larkPlatform.disconnect}
				onOpenChange={larkPlatform.setOpen}
				onReauthorize={larkPlatform.reauthorize}
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

function OrganizationMessageChannelsContent(input: {
	currentUserId: string;
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
}) {
	const queryClient = useQueryClient();
	const { channelsSlackOAuthResult } = useCenterAgentRouteState();
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: true,
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
		messageChannelListQueryOptions({ organizationId: input.organizationId })
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
	const canManage = canManageOrganizationArea(roleQuery.data, {
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
	const messageChannelError =
		channelsQuery.error ?? activeRegistrationsQuery.error;
	return (
		<>
			<AppPageHeader
				description="Channels let you choose where to talk to your Agent."
				descriptionWidth="full"
				eyebrow="Organization"
				title="Channels"
			/>
			<SlackOAuthResultSurface
				canManage={canManage}
				organizationName={input.organizationName}
				organizationSlug={input.organizationSlug}
				result={slackOAuthResult}
			/>
			{roleQuery.isPending ||
			designationQuery.isPending ||
			channelsQuery.isPending ? (
				<p className="text-muted-foreground text-sm">Loading channels.</p>
			) : null}
			<ChannelsLoadError
				channelsError={messageChannelError}
				designationError={designationQuery.error}
				fallback="OpenMeld could not load this organization’s channels."
			/>
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
					onCancelLarkPlatformSetup={larkPlatform.cancelSetup}
					onConnectSlackWorkspace={(variables) =>
						connectSlackMutation.mutate(variables)
					}
					onDisconnectSlackWorkspace={() => disconnectSlackMutation.mutate()}
					onManageLarkPlatform={larkPlatform.manage}
					organizationSlug={input.organizationSlug}
					slackConnection={designationQuery.data.slackConnection}
				/>
			) : null}
			{roleQuery.isError ? (
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
				onReauthorize={larkPlatform.reauthorize}
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

function ChannelsLoadError(input: {
	channelsError: unknown;
	designationError: unknown;
	fallback: string;
}) {
	if (!(input.channelsError || input.designationError)) {
		return null;
	}
	return (
		<p
			className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
			role="alert"
		>
			{input.channelsError
				? resolveMessageChannelErrorMessage(input.channelsError, input.fallback)
				: resolveCenterAgentErrorMessage(
						input.designationError,
						"designation_read"
					)}
		</p>
	);
}

function resolveHasExistingSlackConnection(
	connections?: readonly { provider: string; status: string }[]
): boolean {
	return (
		connections?.some(
			(connection) =>
				connection.provider === "slack" && connection.status === "connected"
		) === true
	);
}
