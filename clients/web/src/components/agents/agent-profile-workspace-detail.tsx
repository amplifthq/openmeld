"use client";

import type {
	AgentWakeAvailability,
	AuthProfileView,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { AgentProfileControllerAvatar } from "#/components/agents/agent-profile-controller-avatar";
import { ProfileDetailsContent } from "#/components/profiles/profile-details-dialog";

export function AgentProfileWorkspaceDetail(input: {
	canEdit: boolean;
	agentControllerRef: string | null;
	controllerModelSummary: string;
	currentSession?: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
	details: ProfileDetailsSnapshot;
	editContent: ReactNode;
	editDisabled: boolean;
	editing: boolean;
	isDirectMessagePending: boolean;
	onEdit: () => void;
	onOpenDirectMessage: () => void;
	overflowActions: ReactNode;
	profile: AuthProfileView;
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
	wakeAvailabilityRecoveryActions?: ReactNode;
}) {
	const fallbackAvailability = resolveFallbackWakeAvailability(input);
	return (
		<div
			className="@container/agent-detail mx-auto w-full max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"
			data-testid="agent-profile-workspace-detail"
		>
			<div className="flex min-w-0 @[42rem]/agent-detail:flex-row flex-col @[42rem]/agent-detail:items-start gap-4">
				<div className="flex min-w-0 flex-1 items-start gap-4">
					<AgentProfileControllerAvatar
						agentControllerRef={input.agentControllerRef}
						className="shrink-0"
						profileId={input.profile.openMeldProfileId}
						size={96}
					/>
					<div className="min-w-0 flex-1 pt-1">
						<h1 className="select-text break-words font-semibold text-xl leading-7">
							{input.profile.profileName}
						</h1>
						<p className="mt-1 break-words text-muted-foreground text-sm">
							{input.controllerModelSummary}
						</p>
						{input.wakeAvailability ? (
							<Tooltip>
								<TooltipTrigger
									render={
										<span
											className={cn(
												"mt-2 inline-flex rounded-md bg-muted px-2 py-1 font-medium text-xs"
											)}
											data-availability-action={
												input.wakeAvailability.action ?? undefined
											}
											data-availability-phase={
												input.wakeAvailability.phase ?? undefined
											}
											data-availability-reason-code={
												input.wakeAvailability.reasonCode ?? undefined
											}
										/>
									}
								>
									{input.wakeAvailability.badgeLabel}
								</TooltipTrigger>
								<TooltipContent className="max-w-sm" side="top">
									{input.wakeAvailability.tooltip}
								</TooltipContent>
							</Tooltip>
						) : (
							<Tooltip>
								<TooltipTrigger
									render={
										<span
											className={cn(
												"mt-2 inline-flex rounded-md bg-muted px-2 py-1 font-medium text-xs",
												fallbackAvailability.className
											)}
										/>
									}
								>
									{fallbackAvailability.label}
								</TooltipTrigger>
								<TooltipContent className="max-w-sm" side="top">
									{fallbackAvailability.tooltip}
								</TooltipContent>
							</Tooltip>
						)}
						{fallbackAvailability.diagnostic ? (
							<p
								className={cn(
									"mt-2 max-w-2xl text-sm",
									input.wakeAvailabilityErrorMessage
										? "text-destructive"
										: "text-muted-foreground"
								)}
								role={input.wakeAvailabilityErrorMessage ? "alert" : undefined}
							>
								{fallbackAvailability.diagnostic}
							</p>
						) : null}
						{input.wakeAvailabilityRecoveryActions ? (
							<div className="mt-3">
								{input.wakeAvailabilityRecoveryActions}
							</div>
						) : null}
					</div>
				</div>
				<div className="flex max-w-full shrink-0 flex-wrap items-center gap-2 self-end">
					<Button
						disabled={input.isDirectMessagePending}
						onClick={input.onOpenDirectMessage}
						size="sm"
						type="button"
						variant="outline"
					>
						<ChatCircleTextIcon aria-hidden="true" data-icon="inline-start" />
						Direct Message
					</Button>
					{input.editing || !input.canEdit ? null : (
						<Button
							disabled={input.editDisabled}
							onClick={input.onEdit}
							size="sm"
							type="button"
							variant="outline"
						>
							<PencilSimpleIcon aria-hidden="true" data-icon="inline-start" />
							Edit Agent
						</Button>
					)}
					{input.overflowActions}
				</div>
			</div>

			{input.editing ? (
				input.editContent
			) : (
				<ProfileDetailsContent
					currentSession={input.currentSession}
					details={input.details}
					showSummary={false}
				/>
			)}
		</div>
	);
}

function resolveFallbackWakeAvailability(input: {
	wakeAvailability: AgentWakeAvailability | null;
	wakeAvailabilityErrorMessage: string | null;
	wakeAvailabilityIsPending: boolean;
}) {
	if (input.wakeAvailability) {
		return { className: "", diagnostic: null, label: "", tooltip: "" };
	}
	if (input.wakeAvailabilityErrorMessage) {
		return {
			className: resolveStatusToneTextClassName("warning"),
			diagnostic: input.wakeAvailabilityErrorMessage,
			label: "Unavailable",
			tooltip: "Status unavailable",
		};
	}
	if (input.wakeAvailabilityIsPending) {
		return {
			className: resolveStatusToneTextClassName("checking"),
			diagnostic: null,
			label: "Loading",
			tooltip: "Loading Wake availability",
		};
	}
	return {
		className: "text-muted-foreground",
		diagnostic: "OpenMeld has not checked this Agent on this computer yet.",
		label: "Not checked",
		tooltip: "Wake availability not checked yet",
	};
}
