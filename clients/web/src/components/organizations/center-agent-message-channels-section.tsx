"use client";

import type {
	GetCenterAgentDesignationResponse,
	LarkPlatformActiveRegistrationProjection,
	LarkPlatformProvider,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { LinkIcon, SignOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
	FEISHU_CHANNEL_IDENTITY,
	LARK_CHANNEL_IDENTITY,
	SLACK_CHANNEL_IDENTITY,
} from "./app-catalog";
import { AppLogo } from "./app-logo";
import { CenterAgentSlackConnectionDialog } from "./center-agent-slack-connection-dialog";

export type CenterAgentSlackConnection = NonNullable<
	GetCenterAgentDesignationResponse["slackConnection"]
>;

export function CenterAgentMessageChannelsSection(input: {
	activeRegistrations?: readonly LarkPlatformActiveRegistrationProjection[];
	activeRegistrationsChecking?: boolean;
	activeRegistrationsUnavailable?: boolean;
	availableProviders?: readonly LarkPlatformProvider[];
	canManage: boolean;
	connections?: readonly MessageChannelConnectionProjection[];
	disableSlackConnect: boolean;
	disableSlackDisconnect: boolean;
	larkPlatformPendingProvider?: LarkPlatformProvider | null;
	managementPath?: string;
	managementMode?: "cleanup" | "inline" | "read-only";
	organizationRequired?: boolean;
	onConnectSlackWorkspace: (input: { slackTeamId: string }) => void;
	onDisconnectSlackWorkspace: () => void;
	onManageLarkPlatform?: (provider: LarkPlatformProvider) => void;
	slackConnection?: CenterAgentSlackConnection;
}) {
	const slackProjection = input.connections?.find(
		(connection) => connection.provider === "slack"
	);
	const slackConnected = slackProjection
		? slackProjection.status === "connected"
		: input.slackConnection?.connected === true;
	const managementMode = input.managementMode ?? "inline";
	const availableProviders = new Set(
		input.availableProviders ?? (["lark", "feishu"] as const)
	);
	const slackStatusLabel = resolveOrganizationRequiredStatusLabel({
		connected: slackConnected,
		organizationRequired: input.organizationRequired === true,
	});
	let slackManagementControl: ReactNode = null;
	if (managementMode === "inline" && input.managementPath) {
		slackManagementControl = (
			<Link
				className={buttonVariants({ size: "sm", variant: "outline" })}
				to={input.managementPath}
			>
				{input.canManage
					? "Manage organization channels"
					: "View organization channels"}
			</Link>
		);
	} else if (managementMode === "inline") {
		slackManagementControl = (
			<CenterAgentSlackConnectionDialog
				canManage={input.canManage}
				connectPending={input.disableSlackConnect}
				disconnectPending={input.disableSlackDisconnect}
				onConnectSlackWorkspace={input.onConnectSlackWorkspace}
				onDisconnectSlackWorkspace={input.onDisconnectSlackWorkspace}
				slackConnection={input.slackConnection}
				trigger={
					<Button size="sm" type="button" variant="outline">
						<LinkIcon aria-hidden="true" data-icon="inline-start" />
						{slackConnected ? "Manage Slack" : "Connect Slack"}
					</Button>
				}
			/>
		);
	}

	return (
		<section aria-label="Channels">
			<FluidCardGroup
				className="grid items-stretch gap-3 xl:grid-cols-2"
				role="list"
			>
				<ChannelCard
					connected={input.organizationRequired ? false : slackConnected}
					description={resolveChannelDescription({
						connected: slackConnected,
						name: "Slack",
						organizationRequired: input.organizationRequired === true,
					})}
					logo={SLACK_CHANNEL_IDENTITY}
					managementControl={slackManagementControl}
					name="Slack"
					statusLabel={slackStatusLabel}
				/>
				{(["lark", "feishu"] as const).map((provider) => {
					const connection = input.connections?.find(
						(candidate) => candidate.provider === provider
					);
					const activeRegistration = input.activeRegistrations?.find(
						(candidate) => candidate.provider === provider
					);
					return availableProviders.has(provider) ||
						connection ||
						activeRegistration ? (
						<LarkPlatformCard
							activeRegistration={activeRegistration}
							activeRegistrationsChecking={
								input.activeRegistrationsChecking === true
							}
							activeRegistrationsUnavailable={
								input.activeRegistrationsUnavailable === true
							}
							canManage={input.canManage}
							connection={connection}
							disabled={input.larkPlatformPendingProvider != null}
							key={provider}
							managementMode={managementMode}
							onManage={input.onManageLarkPlatform}
							organizationRequired={input.organizationRequired === true}
							provider={provider}
						/>
					) : null;
				})}
			</FluidCardGroup>
		</section>
	);
}

function LarkPlatformCard(input: {
	activeRegistration?: LarkPlatformActiveRegistrationProjection;
	activeRegistrationsChecking: boolean;
	activeRegistrationsUnavailable: boolean;
	canManage: boolean;
	connection?: MessageChannelConnectionProjection;
	disabled: boolean;
	managementMode: "cleanup" | "inline" | "read-only";
	onManage?: (provider: LarkPlatformProvider) => void;
	organizationRequired: boolean;
	provider: LarkPlatformProvider;
}) {
	const providerLabel = input.provider === "feishu" ? "Feishu" : "Lark";
	const activeRegistrationUnavailable =
		input.activeRegistrationsUnavailable && input.connection === undefined;
	const checkingSetup =
		(input.activeRegistrationsChecking || activeRegistrationUnavailable) &&
		input.activeRegistration === undefined &&
		input.connection === undefined;
	const status = input.connection?.status ?? input.activeRegistration?.status;
	const connected = status === "connected";
	const hasExistingConnection =
		input.connection !== undefined &&
		input.connection.status !== "disconnected";
	const setupInProgress =
		status === "pending_registration" ||
		status === "credentials_received" ||
		status === "configuring";
	const needsRepair = status === "repair_required" || status === "revoked";
	const canResume = input.activeRegistration?.canResume ?? true;
	const accountName =
		input.connection?.externalAccountName?.trim() || undefined;
	const logo =
		input.provider === "feishu"
			? FEISHU_CHANNEL_IDENTITY
			: LARK_CHANNEL_IDENTITY;
	const actionLabel = resolveLarkPlatformActionLabel({
		connected,
		needsRepair,
		providerLabel,
		setupInProgress,
	});
	const defaultOperationalSummary = resolveLarkPlatformOperationalSummary({
		activeRegistrationUnavailable,
		canManage: input.canManage,
		canResume,
		checkingSetup,
		connection: input.connection,
		providerLabel,
		status,
	});
	const operationalSummary =
		input.organizationRequired && hasExistingConnection
			? {
					...defaultOperationalSummary,
					guidance: `Disconnect this Personal Workspace connection. Then connect ${providerLabel} from the organization you create.`,
				}
			: defaultOperationalSummary;
	const statusLabel = resolveLarkPlatformStatusLabel({
		checkingSetup,
		connected,
		hasExistingConnection,
		organizationRequired: input.organizationRequired,
		status,
	});
	let control: ReactNode = null;
	if (
		input.managementMode === "cleanup" &&
		hasExistingConnection &&
		input.onManage
	) {
		control = (
			<Button
				disabled={input.disabled}
				onClick={() => input.onManage?.(input.provider)}
				size="sm"
				type="button"
				variant="outline"
			>
				<SignOutIcon aria-hidden="true" data-icon="inline-start" />
				Disconnect {providerLabel}
			</Button>
		);
	} else if (
		input.managementMode === "inline" &&
		input.canManage &&
		input.onManage &&
		!checkingSetup &&
		!activeRegistrationUnavailable &&
		canResume
	) {
		control = (
			<Button
				disabled={input.disabled}
				onClick={() => input.onManage?.(input.provider)}
				size="sm"
				type="button"
				variant="outline"
			>
				<LinkIcon aria-hidden="true" data-icon="inline-start" />
				{actionLabel}
			</Button>
		);
	}
	return (
		<ChannelCard
			accountName={accountName}
			connected={input.organizationRequired ? false : connected}
			description={resolveChannelDescription({
				connected: hasExistingConnection,
				connectedAction: "disconnect",
				name: providerLabel,
				organizationRequired: input.organizationRequired,
			})}
			details={operationalSummary.details}
			guidance={operationalSummary.guidance}
			logo={logo}
			managementControl={control}
			name={providerLabel}
			statusLabel={statusLabel}
		/>
	);
}

function ChannelCard(input: {
	accountName?: string;
	connected: boolean;
	description?: string;
	details?: string;
	guidance?: string;
	logo: {
		logoPath: string;
		service: string;
	};
	managementControl: ReactNode;
	name: string;
	statusLabel?: string;
}) {
	const usesThemeAwareLogoSurface =
		input.logo.service === "lark" || input.logo.service === "feishu";
	const hasSupportingContent = Boolean(
		input.accountName || input.details || input.guidance
	);

	return (
		<FluidCardItem itemId={input.name.toLowerCase()} role="listitem">
			<Card className="h-full bg-transparent" size="sm">
				<CardHeader>
					<div className="flex min-w-0 items-center gap-4">
						<AppLogo
							app={input.logo}
							className={usesThemeAwareLogoSurface ? "bg-muted/50" : undefined}
							size="lg"
						/>
						<div className="min-w-0">
							<CardTitle className="text-base">
								<h2>{input.name}</h2>
							</CardTitle>
						</div>
					</div>
					<CardAction className="self-center">
						<Badge
							className={cn(
								"h-7 px-2.5",
								input.connected
									? resolveStatusToneProminentBadgeClassName("ready")
									: "border-border bg-muted/40 text-muted-foreground"
							)}
						>
							{input.statusLabel ??
								(input.connected ? "Connected" : "Not Connected")}
						</Badge>
					</CardAction>
				</CardHeader>
				<CardContent className="flex flex-1 flex-col justify-center gap-4 py-3">
					<CardDescription className="max-w-lg text-foreground/80 text-sm/6">
						{input.description ?? (
							<>
								People can message your Center Agent from {input.name} and
								receive replies in the same conversation.
							</>
						)}
					</CardDescription>
					{hasSupportingContent ? (
						<div className="flex flex-col gap-1">
							{input.accountName ? (
								<p className="truncate font-medium text-foreground text-sm">
									{input.accountName}
								</p>
							) : null}
							{input.details ? (
								<p className="text-muted-foreground text-xs">{input.details}</p>
							) : null}
							{input.guidance ? (
								<p className="mt-1 max-w-xl text-muted-foreground text-xs leading-5">
									{input.guidance}
								</p>
							) : null}
						</div>
					) : null}
				</CardContent>
				{input.managementControl ? (
					<CardFooter className="mt-auto justify-end">
						{input.managementControl}
					</CardFooter>
				) : null}
			</Card>
		</FluidCardItem>
	);
}

function resolveChannelDescription(input: {
	connected: boolean;
	connectedAction?: "disconnect" | "move";
	name: string;
	organizationRequired: boolean;
}): string | undefined {
	if (!input.organizationRequired) {
		return undefined;
	}
	if (!input.connected) {
		return `Create an organization to connect ${input.name} for your teammates.`;
	}
	if (input.connectedAction === "disconnect") {
		return `Disconnect this ${input.name} connection from your Personal Workspace before connecting it to an organization.`;
	}
	return `Move this ${input.name} connection to an organization before teammates use it.`;
}

function resolveOrganizationRequiredStatusLabel(input: {
	connected: boolean;
	organizationRequired: boolean;
}): string | undefined {
	if (!input.organizationRequired) {
		return undefined;
	}
	return input.connected ? "Move required" : "Organization required";
}

function resolveLarkPlatformStatusLabel(input: {
	checkingSetup: boolean;
	connected: boolean;
	hasExistingConnection: boolean;
	organizationRequired: boolean;
	status?: MessageChannelConnectionProjection["status"];
}): string {
	if (input.organizationRequired) {
		return input.hasExistingConnection
			? "Disconnect required"
			: "Organization required";
	}
	const organizationRequiredLabel =
		resolveOrganizationRequiredStatusLabel(input);
	if (organizationRequiredLabel) {
		return organizationRequiredLabel;
	}
	if (input.checkingSetup) {
		return "Checking";
	}
	return resolveConnectionStatusLabel(input.status);
}

type LarkPlatformOperationalInput = {
	activeRegistrationUnavailable: boolean;
	canManage: boolean;
	canResume: boolean;
	checkingSetup: boolean;
	connection?: MessageChannelConnectionProjection;
	providerLabel: string;
	status?: MessageChannelConnectionProjection["status"];
};

function resolveLarkPlatformOperationalSummary(
	input: LarkPlatformOperationalInput
): { details?: string; guidance?: string } {
	const connection = input.connection;
	const capabilityCount = connection?.grantedCapabilityGroups.length ?? 0;
	const details = connection
		? `${connection.transport === "webhook" ? "Webhook" : "WebSocket"} · ${
				capabilityCount
			} channel ${capabilityCount === 1 ? "capability" : "capabilities"} enabled`
		: undefined;
	const hasOperationalState =
		input.activeRegistrationUnavailable ||
		input.checkingSetup ||
		input.status !== undefined;
	return {
		details,
		guidance: hasOperationalState
			? resolveLarkPlatformOperationalGuidance(input)
			: undefined,
	};
}

function resolveLarkPlatformOperationalGuidance(
	input: LarkPlatformOperationalInput
): string {
	const connection = input.connection;
	if (input.activeRegistrationUnavailable) {
		return "OpenMeld could not refresh this setup. Refresh Channels before taking another action.";
	}
	if (input.checkingSetup) {
		return "OpenMeld is checking whether setup is already in progress.";
	}
	if (input.status === "repair_required" && connection) {
		return connection.reasonCode ===
			`${connection.provider}.registration_expired`
			? `${input.providerLabel} setup expired before OpenMeld could verify Webhook delivery.`
			: `OpenMeld could not finish verifying this ${input.providerLabel} app. Select Repair ${input.providerLabel} to try the existing app again.`;
	}
	if (input.status === "revoked") {
		return `The provider revoked this connection. Select Repair ${input.providerLabel} to reconnect it.`;
	}
	if (
		input.status === "pending_registration" ||
		input.status === "credentials_received"
	) {
		if (!input.canManage) {
			return "An organization manager is finishing this setup.";
		}
		if (!input.canResume) {
			return "Setup is in progress. The person who started it can continue.";
		}
		return `Finish setup on the official ${input.providerLabel} page in this browser.`;
	}
	if (input.status === "configuring") {
		return "OpenMeld is verifying Webhook delivery. You can leave this page and return later.";
	}
	if (input.status === "connected") {
		return "The Center Agent replies in the conversation where each request starts.";
	}
	return `Select Connect ${input.providerLabel} to open the official setup flow.`;
}

function resolveLarkPlatformActionLabel(input: {
	connected: boolean;
	needsRepair: boolean;
	providerLabel: string;
	setupInProgress: boolean;
}): string {
	if (input.connected) {
		return `Manage ${input.providerLabel}`;
	}
	if (input.needsRepair) {
		return `Repair ${input.providerLabel}`;
	}
	return input.setupInProgress
		? "Continue setup"
		: `Connect ${input.providerLabel}`;
}

function resolveConnectionStatusLabel(
	status?: MessageChannelConnectionProjection["status"]
): string {
	if (!status || status === "disconnected") {
		return "Not Connected";
	}
	if (status === "connected") {
		return "Connected";
	}
	if (
		status === "pending_registration" ||
		status === "credentials_received" ||
		status === "configuring"
	) {
		return "Connecting";
	}
	return "Needs Attention";
}
