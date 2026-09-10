"use client";

import { LARK_PLATFORM_REGISTRATION_DOMAINS } from "@openmeld/schemas";
import type {
	LarkPlatformProvider,
	LarkPlatformRegistrationResponse,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { resolveStatusToneSoftTextClassName } from "@openmeld/ui/lib/status-tone";
import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	SignOutIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { requiresLarkPlatformSetupAuthorization } from "./lark-platform-setup-authorization";

export function LarkPlatformChannelDialog(input: {
	canManage: boolean;
	cleanupOnly?: boolean;
	connection: MessageChannelConnectionProjection | null;
	disconnectPending: boolean;
	errorMessage: string | null;
	onDisconnect: () => void;
	onOpenChange: (open: boolean) => void;
	onRepair: () => void;
	onReauthorize: () => void;
	onRetryPoll: () => void;
	onStartOver: () => void;
	open: boolean;
	pollPending: boolean;
	provider: LarkPlatformProvider | null;
	registration: LarkPlatformRegistrationResponse | null;
	repairPending: boolean;
	startOverPending: boolean;
}) {
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const providerLabel = resolveProviderLabel(input.provider);
	const connection = input.registration?.connection ?? input.connection ?? null;
	const connected = connection?.status === "connected";
	const needsRepair =
		connection?.status === "repair_required" ||
		connection?.status === "revoked";
	const dialogTitle = input.cleanupOnly
		? `Disconnect ${providerLabel}`
		: resolveDialogTitle({
				connected,
				needsRepair,
				providerLabel,
			});
	const dialogDescription = input.cleanupOnly
		? `This connection belongs to your Personal Workspace. Disconnect it before connecting ${providerLabel} to an organization.`
		: resolveDialogDescription({
				connected,
				needsRepair,
				providerLabel,
			});
	const canDisconnect =
		connection !== null && connection.status !== "disconnected";
	const showAuthorizationAction =
		!(input.registration || input.cleanupOnly) &&
		input.canManage &&
		connection?.reasonCode ===
			`${connection?.provider}.authorization_update_required`;
	const registrationInProgress =
		input.registration !== null &&
		(input.registration.attempt.status === "pending_registration" ||
			input.registration.attempt.status === "credentials_received" ||
			input.registration.attempt.status === "configuring");

	const handleOpenChange = (open: boolean) => {
		if (input.disconnectPending || input.repairPending) {
			return;
		}
		if (!open) {
			setConfirmingDisconnect(false);
		}
		input.onOpenChange(open);
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={input.open}>
			<DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{dialogTitle}</DialogTitle>
					<DialogDescription>{dialogDescription}</DialogDescription>
				</DialogHeader>
				{input.registration && !needsRepair ? (
					<RegistrationProgress
						errorMessage={input.errorMessage}
						onReauthorize={input.onReauthorize}
						onRetryPoll={input.onRetryPoll}
						onStartOver={input.onStartOver}
						pollPending={input.pollPending}
						providerLabel={providerLabel}
						registration={input.registration}
						startOverPending={input.startOverPending}
					/>
				) : (
					<ConnectionSummary
						canManage={input.canManage && !input.cleanupOnly}
						connection={connection}
						errorMessage={input.errorMessage}
						onRepair={input.onRepair}
						onStartOver={input.onStartOver}
						providerLabel={providerLabel}
						repairDisabled={
							input.disconnectPending ||
							input.repairPending ||
							confirmingDisconnect
						}
						repairPending={input.repairPending}
						startOverPending={input.startOverPending}
					/>
				)}
				<DialogFooter className="items-stretch border-t pt-4 empty:hidden sm:items-center sm:justify-between">
					{canDisconnect && input.canManage ? (
						<DisconnectControl
							confirming={confirmingDisconnect}
							disabled={input.repairPending}
							disconnectPending={input.disconnectPending}
							onCancel={() => setConfirmingDisconnect(false)}
							onConfirm={input.onDisconnect}
							onStart={() => setConfirmingDisconnect(true)}
							providerLabel={providerLabel}
						/>
					) : null}
					{registrationInProgress || confirmingDisconnect ? null : (
						<div className="flex justify-end gap-2 sm:ml-auto">
							<Button onClick={() => handleOpenChange(false)} variant="outline">
								Close
							</Button>
							{showAuthorizationAction ? (
								<Button
									disabled={input.disconnectPending || input.repairPending}
									onClick={input.onReauthorize}
								>
									Update permissions
									<ArrowSquareOutIcon
										aria-hidden="true"
										data-icon="inline-end"
									/>
								</Button>
							) : null}
						</div>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function resolveDialogTitle(input: {
	connected: boolean;
	needsRepair: boolean;
	providerLabel: string;
}): string {
	if (input.connected) {
		return `Manage ${input.providerLabel}`;
	}
	return input.needsRepair
		? `Repair ${input.providerLabel}`
		: `Connect ${input.providerLabel}`;
}

function resolveDialogDescription(input: {
	connected: boolean;
	needsRepair: boolean;
	providerLabel: string;
}): string {
	if (input.connected) {
		return "Manage your organization’s Center Agent connection.";
	}
	return input.needsRepair
		? `Retry the existing ${input.providerLabel} app without creating another one.`
		: `Connect your Center Agent to ${input.providerLabel}.`;
}

function RegistrationProgress(input: {
	onReauthorize: () => void;
	errorMessage: string | null;
	onRetryPoll: () => void;
	onStartOver: () => void;
	pollPending: boolean;
	providerLabel: string;
	registration: LarkPlatformRegistrationResponse;
	startOverPending: boolean;
}) {
	const attempt = input.registration.attempt;
	if (attempt.status === "pending_registration" && attempt.registrationUrl) {
		// HTTP retains the shared issuer URL for older readers. Only the browser
		// destination changes; the provider and registration code stay fixed.
		const launcherUrl = new URL(attempt.registrationUrl);
		launcherUrl.hostname =
			LARK_PLATFORM_REGISTRATION_DOMAINS[attempt.provider].launcherHost;
		return (
			<div className="space-y-4">
				<div className="rounded-md bg-muted/40 p-3">
					<p className="font-medium text-foreground text-sm">
						Open the official {input.providerLabel} setup page
					</p>
					<p className="mt-1 text-muted-foreground text-xs/relaxed">
						Sign in to {input.providerLabel}, create a bot, and approve its
						messaging and configuration permissions. OpenMeld will finish
						connecting automatically.
					</p>
					<div className="mt-4 flex flex-wrap gap-2">
						<a
							className={buttonVariants({ size: "default" })}
							href={launcherUrl.toString()}
							rel="noreferrer"
							target="_blank"
						>
							<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
							Open {input.providerLabel} setup
						</a>
						<Button
							disabled={input.startOverPending}
							onClick={input.onStartOver}
							type="button"
							variant="outline"
						>
							{input.startOverPending ? "Starting over…" : "Start over"}
						</Button>
					</div>
					<p className="mt-3 text-muted-foreground text-xs leading-5">
						If {input.providerLabel} could not create the app, start over to get
						a fresh setup link.
					</p>
				</div>
				<WaitingStatus
					errorMessage={input.errorMessage}
					label="Waiting for approval"
					onRetryPoll={input.onRetryPoll}
					pollPending={input.pollPending}
				/>
			</div>
		);
	}
	if (requiresLarkPlatformSetupAuthorization(attempt)) {
		return (
			<div className="space-y-3 rounded-md bg-muted/40 p-3">
				<p className="font-medium text-sm">Authorization required</p>
				<p className="text-muted-foreground text-xs/relaxed">
					Approve the updated permissions in {input.providerLabel} so OpenMeld
					can finish connecting. You’ll keep the same bot.
				</p>
				<div className="flex flex-wrap gap-2">
					<Button onClick={input.onReauthorize} type="button">
						<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-start" />
						Reauthorize {input.providerLabel}
					</Button>
					<Button
						disabled={input.pollPending}
						onClick={input.onRetryPoll}
						type="button"
						variant="outline"
					>
						{input.pollPending
							? "Checking authorization…"
							: "I've authorized, check again"}
					</Button>
				</div>
				{input.errorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
				) : null}
			</div>
		);
	}
	if (
		attempt.status === "credentials_received" ||
		attempt.status === "configuring"
	) {
		return (
			<WaitingStatus
				errorMessage={input.errorMessage}
				label={
					attempt.status === "configuring"
						? "Checking permissions and connecting your bot"
						: "Securing the new app credentials"
				}
				onRetryPoll={input.onRetryPoll}
				pollPending={input.pollPending}
				statusMessage={resolveConfigurationRetryMessage({
					providerLabel: input.providerLabel,
					reasonCode:
						attempt.status === "configuring" ? attempt.reasonCode : null,
				})}
			/>
		);
	}
	if (attempt.status === "connected") {
		return (
			<div className="flex items-start gap-3 rounded-md bg-muted/40 p-3">
				<CheckCircleIcon
					aria-hidden="true"
					className={`mt-0.5 size-4 shrink-0 ${resolveStatusToneSoftTextClassName("ready")}`}
					weight="fill"
				/>
				<div>
					<p className="font-medium text-foreground text-sm">
						{input.providerLabel} connected
					</p>
					<p className="mt-1 text-muted-foreground text-xs/relaxed">
						Members can now message the Center Agent from this organization’s{" "}
						{input.providerLabel} workspace.
					</p>
				</div>
			</div>
		);
	}
	return (
		<RegistrationFailure
			errorMessage={input.errorMessage}
			onStartOver={input.onStartOver}
			provider={attempt.provider}
			providerLabel={input.providerLabel}
			reasonCode={attempt.reasonCode}
			startOverPending={input.startOverPending}
		/>
	);
}

function RegistrationFailure(input: {
	errorMessage: string | null;
	onStartOver: () => void;
	provider: LarkPlatformProvider;
	providerLabel: string;
	reasonCode: string | null;
	startOverPending: boolean;
}) {
	const brandMismatch =
		input.reasonCode ===
		`${input.provider}.registration_provider_brand_mismatch`;
	const otherLabel = input.provider === "lark" ? "Feishu" : "Lark";
	return (
		<div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
			<div className="flex items-start gap-3">
				<WarningCircleIcon
					aria-hidden="true"
					className="mt-0.5 size-4 text-destructive"
				/>
				<div>
					<p className="font-medium text-destructive text-sm">
						Setup did not finish
					</p>
					<p className="mt-1 text-muted-foreground text-sm">
						{brandMismatch
							? `You selected ${input.providerLabel}, but the platform returned a ${otherLabel} account. Switch to a ${input.providerLabel} account before starting over.`
							: `Close this window and start the ${input.providerLabel} connection again.`}
					</p>
				</div>
			</div>
			{brandMismatch ? (
				<Button
					disabled={input.startOverPending}
					onClick={input.onStartOver}
					type="button"
					variant="outline"
				>
					{input.startOverPending ? "Starting over…" : "Start over"}
				</Button>
			) : null}
			{input.errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{input.errorMessage}
				</p>
			) : null}
		</div>
	);
}

function WaitingStatus(input: {
	errorMessage: string | null;
	label: string;
	onRetryPoll: () => void;
	pollPending: boolean;
	statusMessage?: string | null;
}) {
	return (
		<div className="space-y-3 rounded-md bg-muted/40 p-3">
			<div className="flex items-center gap-2">
				<CircleNotchIcon
					aria-hidden="true"
					className="size-4 animate-spin text-muted-foreground"
				/>
				<p className="font-medium text-foreground text-sm">{input.label}</p>
			</div>
			<p className="text-muted-foreground text-xs/relaxed">
				This window updates automatically. You can close it and continue setup
				later.
			</p>
			{input.statusMessage ? (
				<output className="block text-muted-foreground text-sm">
					{input.statusMessage}
				</output>
			) : null}
			{input.errorMessage ? (
				<div className="space-y-2">
					<p className="text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
					<Button
						disabled={input.pollPending}
						onClick={input.onRetryPoll}
						size="sm"
						type="button"
						variant="outline"
					>
						{input.pollPending ? "Checking" : "Check again"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function resolveConfigurationRetryMessage(input: {
	providerLabel: string;
	reasonCode: string | null;
}): string | null {
	if (!input.reasonCode) {
		return null;
	}
	if (input.reasonCode.endsWith(".application_publication_pending")) {
		return `${input.providerLabel} is reviewing the app update. The connection will be ready after approval. OpenMeld will check automatically.`;
	}
	if (input.reasonCode.endsWith(".application_publication_rejected")) {
		return `${input.providerLabel} did not approve the app update. The bot is not connected. Contact your workspace administrator to review the rejection.`;
	}
	if (input.reasonCode.endsWith(".application_publish_failed")) {
		return `OpenMeld could not publish the app update to ${input.providerLabel}. The bot is not connected yet. OpenMeld will retry automatically.`;
	}
	if (input.reasonCode.endsWith(".application_config_failed")) {
		return `OpenMeld could not finish configuring the ${input.providerLabel} app. It will retry automatically.`;
	}
	if (
		input.reasonCode.endsWith(".persistent_connection_failed") ||
		input.reasonCode.endsWith(".persistent_connector_unavailable")
	) {
		return `OpenMeld could not connect to ${input.providerLabel}. It will retry automatically.`;
	}
	if (
		input.reasonCode.endsWith(".registration_transport_failed") ||
		input.reasonCode.endsWith(".registration_http_failed")
	) {
		return `OpenMeld could not reach ${input.providerLabel} during the latest verification check. It will retry automatically.`;
	}
	return "The latest verification check did not finish. OpenMeld will retry automatically.";
}

function RegistrationStartError(input: {
	canManage: boolean;
	errorMessage: string;
	onStartOver: () => void;
	startOverPending: boolean;
}) {
	return (
		<div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
			<p className="text-destructive" role="alert">
				{input.errorMessage}
			</p>
			{input.canManage ? (
				<>
					<p>
						Start over to get a new setup link. If the problem continues,
						contact your administrator.
					</p>
					<Button
						disabled={input.startOverPending}
						onClick={input.onStartOver}
						type="button"
						variant="outline"
					>
						{input.startOverPending ? "Starting over…" : "Start over"}
					</Button>
				</>
			) : null}
		</div>
	);
}

function ConnectionSummary(input: {
	canManage: boolean;
	connection: MessageChannelConnectionProjection | null;
	errorMessage: string | null;
	onRepair: () => void;
	onStartOver: () => void;
	startOverPending: boolean;
	providerLabel: string;
	repairDisabled: boolean;
	repairPending: boolean;
}) {
	if (!input.connection) {
		return input.errorMessage ? (
			<RegistrationStartError
				canManage={input.canManage}
				errorMessage={input.errorMessage}
				onStartOver={input.onStartOver}
				startOverPending={input.startOverPending}
			/>
		) : null;
	}
	const connected = input.connection.status === "connected";
	const needsAuthorization =
		input.connection.reasonCode ===
		`${input.connection.provider}.authorization_update_required`;
	const needsPublication =
		input.connection.reasonCode ===
		`${input.connection.provider}.application_publication_required`;
	const repairLabel = needsPublication
		? `Reconnect ${input.providerLabel}`
		: `Repair ${input.providerLabel}`;
	const needsRepair =
		input.connection.status === "repair_required" ||
		input.connection.status === "revoked";
	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
				<div className="min-w-0">
					<p className="break-words font-medium text-foreground text-sm">
						{input.connection.externalAccountName ??
							`${input.providerLabel} workspace`}
					</p>
				</div>
				<Badge
					className={
						connected
							? `${resolveStatusToneSoftTextClassName("ready")} shrink-0 border-transparent bg-transparent`
							: "shrink-0 border-transparent bg-transparent text-muted-foreground"
					}
				>
					{connected ? "Connected" : "Needs attention"}
				</Badge>
			</div>
			{needsAuthorization ? (
				<div className="space-y-1 py-1 text-sm">
					<p className="font-medium">Permission update available</p>
					<p className="text-muted-foreground text-xs leading-relaxed">
						Review the updated permissions in {input.providerLabel} to enable
						the latest features. You’ll keep the same bot.
					</p>
					{input.canManage ? null : (
						<p>Ask an organization owner or admin to update permissions.</p>
					)}
				</div>
			) : null}
			{needsRepair ? (
				<div className="space-y-3 rounded-md bg-muted/40 p-3">
					<p className="text-muted-foreground text-xs/relaxed">
						{resolveRepairExplanation(input.connection, input.providerLabel)}
					</p>
					{input.canManage ? (
						<Button
							disabled={input.repairDisabled}
							onClick={input.onRepair}
							type="button"
						>
							{input.repairPending
								? `Repairing ${input.providerLabel}`
								: repairLabel}
						</Button>
					) : null}
				</div>
			) : null}
			{input.errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{input.errorMessage}
				</p>
			) : null}
		</div>
	);
}

function resolveRepairExplanation(
	connection: MessageChannelConnectionProjection,
	providerLabel: string
): string {
	if (
		connection.reasonCode ===
		`${connection.provider}.application_publication_required`
	) {
		return `Reconnect this bot and approve the updated permissions in ${providerLabel}. OpenMeld needs to publish its message-delivery settings before you can use the Center Agent here.`;
	}
	if (connection.reasonCode === `${connection.provider}.registration_expired`) {
		return "Setup expired before OpenMeld could verify this app’s permissions and establish a connection. Repair retries the existing app; it does not create another one.";
	}
	if (connection.status === "revoked") {
		return `${providerLabel} stopped authorizing this app. Repair checks the existing app again; if access was permanently revoked, disconnect it and connect a new app.`;
	}
	return `OpenMeld could not finish verifying this ${providerLabel} app. Repair retries the existing app without creating another one.`;
}

function DisconnectControl(input: {
	confirming: boolean;
	disabled: boolean;
	disconnectPending: boolean;
	onCancel: () => void;
	onConfirm: () => void;
	onStart: () => void;
	providerLabel: string;
}) {
	if (!input.confirming) {
		return (
			<Button
				className="text-muted-foreground hover:text-destructive"
				disabled={input.disabled || input.disconnectPending}
				onClick={input.onStart}
				type="button"
				variant="ghost"
			>
				<SignOutIcon aria-hidden="true" data-icon="inline-start" />
				Disconnect {input.providerLabel}
			</Button>
		);
	}
	return (
		<div className="w-full space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
			<div>
				<p className="font-medium text-destructive text-sm">
					Disconnect {input.providerLabel}?
				</p>
				<p className="mt-1 text-muted-foreground text-sm">
					The Center Agent will stop receiving and replying to messages from
					this {input.providerLabel} workspace.
				</p>
			</div>
			<div className="flex justify-end gap-2">
				<Button
					disabled={input.disabled || input.disconnectPending}
					onClick={input.onCancel}
					type="button"
					variant="outline"
				>
					Cancel
				</Button>
				<Button
					disabled={input.disabled || input.disconnectPending}
					onClick={input.onConfirm}
					type="button"
					variant="destructive"
				>
					{input.disconnectPending ? "Disconnecting" : "Disconnect"}
				</Button>
			</div>
		</div>
	);
}

function resolveProviderLabel(
	provider: LarkPlatformProvider | null
): "Feishu" | "Lark" {
	return provider === "feishu" ? "Feishu" : "Lark";
}
