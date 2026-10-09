"use client";

import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { AgentProfileEditDialogContext } from "#/components/agents/agent-profile-edit-dialog-controller";
import { AgentProfileProjectSettingsDialog } from "#/components/profiles/agent-profile-project-settings-dialog";
import { agentExecutionReadinessBatchQueryOptions } from "#/query/agents/execution-readiness";
import { agentProfileControllerChangeEligibilityQueryOptions } from "#/query/profiles/primary-binding";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";

export function AgentWorkingFolderRecoveryAction(input: {
	className?: string;
	profileId?: string;
}) {
	const edit = useOptionalSpaceAgentProfileEditContext();
	const profile = input.profileId
		? edit?.profilesById.get(input.profileId)
		: undefined;
	if (!(profile && edit?.context)) {
		return (
			<p className="text-muted-foreground text-xs">
				Ask this agent’s owner to review its working folder.
			</p>
		);
	}
	return (
		<OwnerWorkingFolderRecoveryAction
			className={input.className}
			context={edit.context}
			key={profile.openMeldProfileId}
			profile={profile}
		/>
	);
}

function OwnerWorkingFolderRecoveryAction(input: {
	className?: string;
	context: AgentProfileEditDialogContext;
	profile: AuthProfileView;
}) {
	const [open, setOpen] = useState(false);
	// This is the folder draft's frozen target, not a replacement for Core's
	// current readiness. Refreshes must neither reset it nor retarget the draft.
	const [draftTarget, setDraftTarget] = useState<{
		target: PeopleComputerTarget;
		agentControllerRef: string | null;
		bindingKey: string | null;
	} | null>(null);
	const readiness = useQuery({
		...agentExecutionReadinessBatchQueryOptions({
			agentProfileIds: [input.profile.openMeldProfileId],
			enabled: open,
			organizationId: input.context.organizationId,
			storageScope: input.context.storageScope,
		}),
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
	const eligibility = useQuery({
		...agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: open,
			organizationId: input.context.organizationId,
			storageScope: input.context.storageScope,
		}),
		refetchOnWindowFocus: false,
	});
	const current = readiness.data?.items.find(
		(item) => item.agentProfileId === input.profile.openMeldProfileId
	);
	const target =
		current?.routeDeviceId && current.routeLane
			? { deviceId: current.routeDeviceId, runtimeLane: current.routeLane }
			: null;
	const loading =
		readiness.isPending ||
		eligibility.isPending ||
		readiness.isFetching ||
		eligibility.isFetching;
	const bindingKey = folderDraftBindingKey(current);
	useEffect(() => {
		if (!open) {
			setDraftTarget(null);
			return;
		}
		if (
			!(draftTarget || loading || readiness.isError || eligibility.isError) &&
			target &&
			eligibility.data
		) {
			setDraftTarget({
				target,
				agentControllerRef: current?.agentControllerRef ?? null,
				bindingKey,
			});
		}
	}, [
		open,
		draftTarget,
		loading,
		readiness.isError,
		eligibility.isError,
		target,
		eligibility.data,
		current?.agentControllerRef,
		bindingKey,
	]);
	const saveBlockedReason = resolveFolderDraftBlockReason({
		draftTarget,
		currentTarget: target,
		currentAgentControllerRef: current?.agentControllerRef ?? null,
		currentBindingKey: bindingKey,
		checking: loading,
		failed: readiness.isError || eligibility.isError,
	});
	return (
		<>
			<Button
				className={input.className}
				onClick={() => setOpen(true)}
				size="sm"
				variant="outline"
			>
				Review working folder
			</Button>
			{draftTarget ? (
				<AgentProfileProjectSettingsDialog
					actorProfileId={input.context.actorProfileId}
					agentControllerRef={draftTarget.agentControllerRef}
					currentWorkingFolder={null}
					executionTargetChangeEligibilityStatus={
						eligibility.data?.status ?? "unavailable"
					}
					onOpenChange={setOpen}
					onProfileUpdated={() => {
						input.context
							.onSaved(input.profile.openMeldProfileId)
							.catch((error: unknown) => {
								console.error(
									"Failed to refresh working-folder settings.",
									error
								);
							});
					}}
					open={open}
					organizationId={input.context.organizationId}
					profile={input.profile}
					saveBlockedReason={saveBlockedReason}
					target={draftTarget.target}
				/>
			) : (
				<Dialog onOpenChange={setOpen} open={open}>
					<DialogContent className="sm:max-w-lg">
						<DialogHeader>
							<DialogTitle>Working folder</DialogTitle>
						</DialogHeader>
						<output className="text-muted-foreground text-sm">
							{loading
								? "Checking the Computer that runs this Agent…"
								: "Couldn’t confirm this Agent’s Computer and settings. Try again."}
						</output>
						<DialogFooter>
							<Button onClick={() => setOpen(false)} variant="ghost">
								Cancel
							</Button>
							{loading ? null : (
								<Button
									onClick={() => {
										Promise.all([
											readiness.refetch(),
											eligibility.refetch(),
										]).catch((error: unknown) => {
											console.error(
												"Failed to reload working-folder settings.",
												error
											);
										});
									}}
								>
									Try again
								</Button>
							)}
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
		</>
	);
}

function resolveFolderDraftBlockReason(input: {
	draftTarget: {
		target: PeopleComputerTarget;
		agentControllerRef: string | null;
		bindingKey: string | null;
	} | null;
	currentTarget: PeopleComputerTarget | null;
	currentAgentControllerRef: string | null;
	currentBindingKey: string | null;
	checking: boolean;
	failed: boolean;
}): string | undefined {
	if (!input.draftTarget) {
		return undefined;
	}
	if (input.checking) {
		return "Checking this Agent’s current Computer…";
	}
	if (input.failed || !input.currentTarget) {
		return "Couldn’t confirm this Agent’s current Computer. Your changes are still here. Close and reopen Working folder to try again.";
	}
	if (
		input.currentTarget.deviceId !== input.draftTarget.target.deviceId ||
		input.currentTarget.runtimeLane !== input.draftTarget.target.runtimeLane ||
		input.currentAgentControllerRef !== input.draftTarget.agentControllerRef ||
		input.currentBindingKey !== input.draftTarget.bindingKey
	) {
		return "This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings.";
	}
	return undefined;
}

function folderDraftBindingKey(
	readiness: GetAgentExecutionReadinessResponse | undefined
): string | null {
	const binding = readiness?.primaryBinding;
	if (!binding?.executionTarget) {
		return null;
	}
	return JSON.stringify([
		binding.bindingId ?? null,
		binding.executionTarget.openMeldServiceRuntimeId.value,
		binding.executionTarget.agentControllerRef,
		binding.executionTarget.agentControllerConversationId ?? null,
	]);
}
