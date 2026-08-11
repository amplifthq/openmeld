"use client";

import type {
	LarkPlatformActiveRegistrationProjection,
	LarkPlatformProvider,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Card } from "@openmeld/ui/components/card";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	ArrowRightIcon,
	CheckIcon,
	CircleNotchIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	FEISHU_CHANNEL_IDENTITY,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "#/components/organizations/app-catalog";
import { AppLogo } from "#/components/organizations/app-logo";
import { LarkPlatformChannelDialog } from "#/components/organizations/lark-platform-channel-dialog";
import { useLarkPlatformChannelManagement } from "#/components/organizations/use-lark-platform-channel-management";
import { resolveCenterAgentErrorMessage } from "#/lib/organizations/center-agent";
import { resolveMessageChannelErrorMessage } from "#/lib/organizations/message-channels";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	centerAgentDesignationQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import {
	activeLarkPlatformRegistrationListQueryOptions,
	messageChannelListQueryOptions,
} from "#/query/organizations/message-channels";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";

const SLACK_AUTHORIZATION_POLL_INTERVAL_MS = 1200;
const SLACK_AUTHORIZATION_TIMEOUT_MS = 120_000;

export function ChannelsOnboardingStep(input: { onContinue: () => void }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const [slackAuthorizationWaiting, setSlackAuthorizationWaiting] =
		useState(false);
	const [slackAuthorizationError, setSlackAuthorizationError] = useState<
		string | null
	>(null);
	const slackAuthorizationPopupRef = useRef<Window | null>(null);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: currentOrganization.isPersonal !== true,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const designationQuery = useQuery({
		...centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		}),
		refetchInterval: slackAuthorizationWaiting
			? SLACK_AUTHORIZATION_POLL_INTERVAL_MS
			: false,
	});
	const channelsQuery = useQuery(
		messageChannelListQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const activeRegistrationsQuery = useQuery(
		activeLarkPlatformRegistrationListQueryOptions({
			organizationId: currentOrganization.id,
			queryClient,
		})
	);
	const larkPlatform = useLarkPlatformChannelManagement({
		connections: channelsQuery.data?.connections ?? [],
		organizationId: currentOrganization.id,
	});
	const canManage =
		currentOrganization.isPersonal === true ||
		canManageOrganizationArea(roleQuery.data, {
			channel: ["connect"],
		});
	const slackConnected =
		designationQuery.data?.slackConnection?.connected === true;
	const closeSlackAuthorizationPopup = useCallback(() => {
		slackAuthorizationPopupRef.current?.close();
		slackAuthorizationPopupRef.current = null;
	}, []);

	useEffect(() => {
		if (!(slackAuthorizationWaiting && slackConnected)) {
			return;
		}
		closeSlackAuthorizationPopup();
		setSlackAuthorizationWaiting(false);
		setSlackAuthorizationError(null);
		queryClient
			.invalidateQueries({
				queryKey: centerAgentQueryKeys.designation(currentOrganization.id),
			})
			.catch((error: unknown) => {
				console.error(
					"OpenMeld connected Slack but could not refresh its designation.",
					{
						error,
						organizationId: currentOrganization.id,
					}
				);
			});
	}, [
		closeSlackAuthorizationPopup,
		currentOrganization.id,
		queryClient,
		slackAuthorizationWaiting,
		slackConnected,
	]);

	useEffect(() => {
		if (!slackAuthorizationWaiting) {
			return;
		}
		const timeout = window.setTimeout(() => {
			closeSlackAuthorizationPopup();
			setSlackAuthorizationWaiting(false);
			setSlackAuthorizationError(
				"Slack setup is still incomplete. You can try again or continue without it."
			);
		}, SLACK_AUTHORIZATION_TIMEOUT_MS);
		return () => window.clearTimeout(timeout);
	}, [closeSlackAuthorizationPopup, slackAuthorizationWaiting]);

	useEffect(
		() => () => {
			closeSlackAuthorizationPopup();
		},
		[closeSlackAuthorizationPopup]
	);

	const startSlackAuthorization = () => {
		if (!(canManage && designationQuery.isSuccess) || slackConnected) {
			return;
		}
		setSlackAuthorizationError(null);
		const popup = window.open(
			"/slack/oauth/start",
			"openmeld-slack-authorization",
			"popup,width=720,height=760"
		);
		if (!popup) {
			setSlackAuthorizationError(
				"Your browser blocked the Slack window. Allow pop-ups for OpenMeld and try again."
			);
			return;
		}
		popup.opener = null;
		slackAuthorizationPopupRef.current = popup;
		setSlackAuthorizationWaiting(true);
		popup.focus();
	};
	const retryReads = () => {
		Promise.allSettled([
			roleQuery.refetch(),
			designationQuery.refetch(),
			channelsQuery.refetch(),
			activeRegistrationsQuery.refetch(),
		]).catch((error: unknown) => {
			console.error("OpenMeld could not schedule the Channels refresh.", {
				error,
				organizationId: currentOrganization.id,
			});
		});
	};
	const channelsError =
		designationQuery.error ??
		channelsQuery.error ??
		activeRegistrationsQuery.error ??
		roleQuery.error;

	return (
		<>
			<div className="flex flex-1 flex-col">
				<div className="grid gap-3">
					<ChannelChoice
						accountName={
							designationQuery.data?.slackConnection?.workspaceName ?? null
						}
						canManage={canManage}
						connected={slackConnected}
						description="Let your team message Center Agent from Slack."
						disabled={
							slackAuthorizationWaiting ||
							designationQuery.isPending ||
							designationQuery.isError
						}
						label="Slack"
						logo={SLACK_CHANNEL_IDENTITY}
						onManage={startSlackAuthorization}
						pending={slackAuthorizationWaiting}
					/>
					{resolveVisibleLarkProviders({
						availableProviders:
							channelsQuery.data?.availableLarkPlatformProviders ?? [],
						connections: channelsQuery.data?.connections ?? [],
					}).map((provider) => (
						<LarkChannelChoice
							activeRegistration={activeRegistrationsQuery.data?.registrations.find(
								(registration) => registration.provider === provider
							)}
							canManage={canManage}
							connection={channelsQuery.data?.connections.find(
								(connection) => connection.provider === provider
							)}
							key={provider}
							onManage={() => larkPlatform.manage(provider)}
							pending={larkPlatform.beginPendingProvider === provider}
							provider={provider}
						/>
					))}
				</div>

				{channelsError ? (
					<div
						className="mt-3 flex items-start justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/5 p-3"
						role="alert"
					>
						<div className="flex min-w-0 items-start gap-2">
							<WarningCircleIcon
								aria-hidden="true"
								className="mt-0.5 size-4 shrink-0 text-destructive"
							/>
							<p className="text-destructive text-xs leading-5">
								{resolveChannelsErrorMessage(channelsError)}
							</p>
						</div>
						<Button
							onClick={retryReads}
							size="xs"
							type="button"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}
				{slackAuthorizationError ? (
					<p className="mt-3 text-destructive text-xs" role="alert">
						{slackAuthorizationError}
					</p>
				) : null}

				<div className="mt-auto flex items-center justify-between gap-4 border-border/70 border-t pt-5">
					<p className="text-muted-foreground text-xs">
						{canManage
							? "Connect one now, or do it later."
							: "An organization admin manages shared Channels."}
					</p>
					<Button onClick={input.onContinue} type="button">
						Continue
						<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
					</Button>
				</div>
			</div>
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

function LarkChannelChoice(input: {
	activeRegistration?: LarkPlatformActiveRegistrationProjection;
	canManage: boolean;
	connection?: MessageChannelConnectionProjection;
	onManage: () => void;
	pending: boolean;
	provider: LarkPlatformProvider;
}) {
	const label = input.provider === "feishu" ? "Feishu" : "Lark";
	const logo =
		input.provider === "feishu"
			? FEISHU_CHANNEL_IDENTITY
			: LARK_CHANNEL_IDENTITY;
	const connected = input.connection?.status === "connected";
	const registrationPending = input.activeRegistration !== undefined;
	return (
		<ChannelChoice
			accountName={input.connection?.externalAccountName ?? null}
			canManage={input.canManage}
			connected={connected}
			description={`Let your team message Center Agent from ${label}.`}
			disabled={input.pending}
			label={label}
			logo={logo}
			onManage={input.onManage}
			pending={input.pending || registrationPending}
		/>
	);
}

function ChannelChoice(input: {
	accountName: string | null;
	canManage: boolean;
	connected: boolean;
	description: string;
	disabled: boolean;
	label: string;
	logo: { logoPath: string; service: string };
	onManage: () => void;
	pending: boolean;
}) {
	const statusLabel = input.pending ? "Connecting…" : "Not connected";
	return (
		<Card className="flex min-h-24 flex-row items-center gap-4 rounded-md p-4">
			<AppLogo app={input.logo} size="lg" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="font-medium text-sm">{input.label}</p>
					{input.connected ? (
						<Badge
							className={resolveStatusToneProminentBadgeClassName("ready")}
						>
							<CheckIcon
								aria-hidden="true"
								data-icon="inline-start"
								weight="bold"
							/>
							Connected
						</Badge>
					) : null}
				</div>
				<p className="mt-1 text-muted-foreground text-xs">
					{input.description}
				</p>
				{input.connected && input.accountName ? (
					<p className="mt-1 truncate text-muted-foreground text-xs">
						Connected to {input.accountName}
					</p>
				) : null}
				{input.connected ? null : (
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{statusLabel}
					</p>
				)}
			</div>
			{input.canManage && !input.connected ? (
				<Button
					disabled={input.disabled}
					onClick={input.onManage}
					size="sm"
					type="button"
					variant="outline"
				>
					{input.pending ? (
						<CircleNotchIcon aria-hidden="true" className="animate-spin" />
					) : null}
					Connect {input.label}
				</Button>
			) : null}
			{input.canManage || input.connected ? null : (
				<span className="text-muted-foreground text-xs">Admin only</span>
			)}
		</Card>
	);
}

function resolveVisibleLarkProviders(input: {
	availableProviders: readonly LarkPlatformProvider[];
	connections: readonly MessageChannelConnectionProjection[];
}): LarkPlatformProvider[] {
	const providers = new Set<LarkPlatformProvider>(input.availableProviders);
	for (const connection of input.connections) {
		if (connection.provider === "lark" || connection.provider === "feishu") {
			providers.add(connection.provider);
		}
	}
	return [...providers];
}

function resolveChannelsErrorMessage(error: unknown): string {
	const channelMessage = resolveMessageChannelErrorMessage(error, "");
	if (channelMessage) {
		return channelMessage;
	}
	return resolveCenterAgentErrorMessage(error, "designation_read");
}
