"use client";

import type { CenterAgentSlackWorkspaceConnection } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	resolveStatusToneProminentBadgeClassName,
	resolveStatusToneSoftTextClassName,
} from "@openmeld/ui/lib/status-tone";
import {
	LinkIcon,
	SignOutIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import {
	type FormEvent,
	type ReactElement,
	type ReactNode,
	useId,
	useState,
} from "react";
import { buildSlackOAuthStartPath } from "#/lib/slack-oauth-start";

type CenterAgentSlackConnectionDialogBaseInput = {
	organizationSlug: string;
	slackConnection?: CenterAgentSlackWorkspaceConnection;
	trigger: ReactElement;
};

type CenterAgentSlackConnectionDialogInput =
	CenterAgentSlackConnectionDialogBaseInput &
		(
			| {
					managementPath: string;
					mode: "channels-handoff";
			  }
			| {
					canManage: boolean;
					connectPending?: boolean;
					disconnectPending?: boolean;
					errorMessage?: string | null;
					mode?: "inline";
					onConnectSlackWorkspace?: (input: { slackTeamId: string }) => void;
					onDisconnectSlackWorkspace?: () => void;
			  }
		);

export function CenterAgentSlackConnectionDialog(
	input: CenterAgentSlackConnectionDialogInput
) {
	const [open, setOpen] = useState(false);
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const [slackTeamId, setSlackTeamId] = useState("");
	const inputId = useId();
	const connected = input.slackConnection?.connected === true;
	const normalizedSlackTeamId = slackTeamId.trim();
	const canSubmitConnect =
		input.mode !== "channels-handoff" &&
		input.canManage &&
		normalizedSlackTeamId.length > 0 &&
		input.connectPending !== true &&
		typeof input.onConnectSlackWorkspace === "function";

	const handleOpenChange = (nextOpen: boolean) => {
		if (
			input.mode !== "channels-handoff" &&
			(input.connectPending || input.disconnectPending)
		) {
			return;
		}
		setOpen(nextOpen);
		if (!nextOpen) {
			setConfirmingDisconnect(false);
			setSlackTeamId("");
		}
	};
	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (input.mode === "channels-handoff" || !canSubmitConnect) {
			return;
		}
		input.onConnectSlackWorkspace?.({ slackTeamId: normalizedSlackTeamId });
	};
	let dialogContent: ReactNode;
	if (input.mode === "channels-handoff") {
		dialogContent = (
			<SlackSettingsHandoffContent
				managementPath={input.managementPath}
				slackConnection={input.slackConnection}
			/>
		);
	} else if (connected) {
		dialogContent = (
			<ConnectedSlackDialogContent
				canManage={input.canManage}
				confirmingDisconnect={confirmingDisconnect}
				disconnectPending={input.disconnectPending}
				errorMessage={input.errorMessage}
				onCancelDisconnect={() => setConfirmingDisconnect(false)}
				onDisconnectSlackWorkspace={input.onDisconnectSlackWorkspace}
				onStartDisconnect={() => setConfirmingDisconnect(true)}
				slackConnection={input.slackConnection}
			/>
		);
	} else {
		dialogContent = (
			<DisconnectedSlackDialogContent
				canManage={input.canManage}
				canSubmitConnect={canSubmitConnect}
				connectPending={input.connectPending}
				errorMessage={input.errorMessage}
				inputId={inputId}
				onSlackTeamIdChange={setSlackTeamId}
				onSubmit={handleSubmit}
				organizationSlug={input.organizationSlug}
				slackTeamId={slackTeamId}
			/>
		);
	}

	return (
		<Dialog onOpenChange={handleOpenChange} open={open}>
			<DialogTrigger render={input.trigger} />
			<DialogContent className="gap-5 p-5 sm:max-w-lg sm:p-6">
				<DialogHeader>
					<DialogTitle className="text-base">
						{resolveDialogTitle({ connected, input })}
					</DialogTitle>
					<DialogDescription className="max-w-md text-sm/6">
						{resolveDialogDescription({ connected, input })}
					</DialogDescription>
				</DialogHeader>
				{dialogContent}
			</DialogContent>
		</Dialog>
	);
}

function resolveDialogTitle(input: {
	connected: boolean;
	input: CenterAgentSlackConnectionDialogInput;
}): string {
	if (!input.connected) {
		return "Connect Slack";
	}
	return input.input.mode === "channels-handoff"
		? "Slack connected"
		: "Manage Slack";
}

function resolveDialogDescription(input: {
	connected: boolean;
	input: CenterAgentSlackConnectionDialogInput;
}): string {
	if (input.input.mode === "channels-handoff") {
		return "Slack connections are managed in Center Agent → Channels.";
	}
	return input.connected
		? "People can message your Center Agent from this Slack workspace and receive replies in the same conversation."
		: "Connect Slack so people can message your Center Agent and receive replies in Slack.";
}

function SlackSettingsHandoffContent(input: {
	managementPath: string;
	slackConnection?: CenterAgentSlackWorkspaceConnection;
}) {
	const connected = input.slackConnection?.connected === true;
	const workspaceLabel = resolveSlackWorkspaceLabel(input.slackConnection);

	return (
		<div className="space-y-4">
			{connected ? (
				<div className="flex items-start justify-between gap-4 rounded-md border border-border/70 bg-card/30 p-3">
					<div className="min-w-0">
						<p className="font-medium text-foreground text-sm">
							Connected to {workspaceLabel}
						</p>
						{input.slackConnection?.slackTeamId ? (
							<p className="mt-1 text-muted-foreground text-xs">
								Workspace ID: {input.slackConnection.slackTeamId}
							</p>
						) : null}
					</div>
					<Badge className={resolveStatusToneProminentBadgeClassName("ready")}>
						Connected
					</Badge>
				</div>
			) : null}
			<p className="text-muted-foreground text-sm">
				{connected
					? "Open Channels to review or change this organization's Slack connection."
					: "Organization owners and admins connect Slack in Center Agent → Channels."}
			</p>
			<DialogFooter showCloseButton>
				<Link
					className={buttonVariants({ size: "default" })}
					to={input.managementPath}
				>
					{connected ? "Manage in Channels" : "Open Channels"}
				</Link>
			</DialogFooter>
		</div>
	);
}

function ConnectedSlackDialogContent(input: {
	canManage: boolean;
	confirmingDisconnect: boolean;
	disconnectPending?: boolean;
	errorMessage?: string | null;
	onCancelDisconnect: () => void;
	onDisconnectSlackWorkspace?: () => void;
	onStartDisconnect: () => void;
	slackConnection?: CenterAgentSlackWorkspaceConnection;
}) {
	const workspaceName =
		input.slackConnection?.workspaceName?.trim() || "Slack workspace";
	const slackTeamId = input.slackConnection?.slackTeamId;

	return (
		<div className="space-y-5">
			<SlackDialogError message={input.errorMessage} />
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0">
					<p className="truncate font-medium text-foreground text-sm">
						{workspaceName}
					</p>
					{slackTeamId ? (
						<p className="mt-1 text-muted-foreground text-xs">
							Workspace ID ·{" "}
							<span className="font-mono text-foreground/80">
								{slackTeamId}
							</span>
						</p>
					) : null}
				</div>
				<Badge
					className={`h-7 px-2.5 ${resolveStatusToneProminentBadgeClassName(
						"ready"
					)}`}
				>
					Connected
				</Badge>
			</div>
			<p className="max-w-md text-muted-foreground text-sm/6">
				OpenMeld sign-in is only required when someone asks for private
				organization context or an authorized action.
			</p>
			{input.canManage ? (
				<SlackDisconnectControl
					confirming={input.confirmingDisconnect}
					disconnectPending={input.disconnectPending}
					onCancel={input.onCancelDisconnect}
					onConfirm={input.onDisconnectSlackWorkspace}
					onStart={input.onStartDisconnect}
				/>
			) : null}
		</div>
	);
}

function SlackDisconnectControl(input: {
	confirming: boolean;
	disconnectPending?: boolean;
	onCancel: () => void;
	onConfirm?: () => void;
	onStart: () => void;
}) {
	if (!input.confirming) {
		return (
			<div className="flex flex-col gap-3 border-border/70 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
				<p className="max-w-sm text-muted-foreground text-xs/5">
					Disconnecting stops messages from this Slack workspace from reaching
					your Center Agent.
				</p>
				<Button
					disabled={input.disconnectPending}
					onClick={input.onStart}
					size="sm"
					type="button"
					variant="outline"
				>
					<SignOutIcon aria-hidden="true" data-icon="inline-start" />
					Disconnect Slack
				</Button>
			</div>
		);
	}

	return (
		<div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
			<div className="space-y-3">
				<div
					className={`flex gap-2 text-sm ${resolveStatusToneSoftTextClassName("warning")}`}
				>
					<WarningCircleIcon
						aria-hidden="true"
						className="mt-0.5 size-4 shrink-0"
					/>
					<p>
						Disconnecting stops Slack messages from reaching the Center Agent
						for this organization.
					</p>
				</div>
				<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
					<Button
						disabled={input.disconnectPending}
						onClick={input.onCancel}
						size="sm"
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={input.disconnectPending}
						onClick={input.onConfirm}
						size="sm"
						type="button"
						variant="destructive"
					>
						<SignOutIcon aria-hidden="true" data-icon="inline-start" />
						{input.disconnectPending ? "Disconnecting..." : "Disconnect Slack"}
					</Button>
				</div>
			</div>
		</div>
	);
}

function DisconnectedSlackDialogContent(input: {
	canManage: boolean;
	canSubmitConnect: boolean;
	connectPending?: boolean;
	errorMessage?: string | null;
	inputId: string;
	onSlackTeamIdChange: (value: string) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	organizationSlug: string;
	slackTeamId: string;
}) {
	return (
		<div className="space-y-4">
			<SlackDialogError message={input.errorMessage} />
			{input.canManage ? (
				<>
					<div className="space-y-3 border border-border/70 bg-card/30 p-4">
						<div className="space-y-1">
							<p className="font-medium text-foreground text-sm">
								Choose your workspace on Slack
							</p>
							<p className="text-muted-foreground text-sm">
								Slack will ask you to choose a workspace and approve the
								OpenMeld app. Approval installs the app and connects it here.
							</p>
						</div>
						<a
							className={buttonVariants({ size: "default" })}
							href={buildSlackOAuthStartPath({
								organizationSlug: input.organizationSlug,
							})}
						>
							<LinkIcon aria-hidden="true" data-icon="inline-start" />
							Add to Slack
						</a>
					</div>
					<details className="border border-border/70">
						<summary className="cursor-pointer px-4 py-3 font-medium text-foreground text-sm marker:text-muted-foreground">
							Advanced: connect manually
						</summary>
						<div className="space-y-4 border-border/70 border-t p-4">
							<p className="text-muted-foreground text-sm">
								Use this option only when the Slack app was installed outside of
								OpenMeld and you already know its workspace ID.
							</p>
							<SlackConnectionSteps />
							<form className="space-y-4" onSubmit={input.onSubmit}>
								<div className="space-y-2">
									<Label htmlFor={input.inputId}>Slack workspace ID</Label>
									<Input
										disabled={input.connectPending}
										id={input.inputId}
										onChange={(event) =>
											input.onSlackTeamIdChange(event.target.value)
										}
										placeholder="T0123456789"
										value={input.slackTeamId}
									/>
								</div>
								<Button
									disabled={!input.canSubmitConnect}
									size="sm"
									type="submit"
								>
									<LinkIcon aria-hidden="true" data-icon="inline-start" />
									{input.connectPending ? "Connecting..." : "Connect manually"}
								</Button>
							</form>
						</div>
					</details>
				</>
			) : (
				<p className="border border-border/70 bg-card/30 p-3 text-muted-foreground text-sm">
					Ask an organization owner or admin to connect Slack.
				</p>
			)}
			<DialogFooter showCloseButton />
		</div>
	);
}

function SlackConnectionSteps() {
	return (
		<ol className="grid gap-3 text-muted-foreground text-sm">
			<li className="border border-border/70 p-3">
				<span className="font-medium text-foreground">1. </span>
				Install the OpenMeld Center Agent Slack app in the workspace you want to
				connect.
			</li>
			<li className="border border-border/70 p-3">
				<span className="font-medium text-foreground">2. </span>
				Copy the Slack workspace ID from Slack admin or the app event payload.
			</li>
			<li className="border border-border/70 p-3">
				<span className="font-medium text-foreground">3. </span>
				Connect the workspace here. Anyone in it can talk to the Center Agent.
				OpenMeld sign-in is only needed for private context or authorized
				actions.
			</li>
		</ol>
	);
}

function SlackDialogError(input: { message?: string | null }) {
	return input.message ? (
		<p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-destructive text-sm">
			{input.message}
		</p>
	) : null;
}

function resolveSlackWorkspaceLabel(
	connection?: CenterAgentSlackWorkspaceConnection
): string {
	return (
		connection?.workspaceName?.trim() ||
		connection?.slackTeamId ||
		"Slack workspace"
	);
}
