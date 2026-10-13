"use client";

import type {
	AgentProfileBindingTarget,
	AuthProfileView,
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
import { AgentProfileProjectSettingsDialog } from "#/components/profiles/agent-profile-project-settings-dialog";
import { projectAgentProfileBindingTarget } from "#/lib/profiles/agent-profile-primary-binding";
import { agentExecutionReadinessBatchQueryOptions } from "#/query/agents/execution-readiness";
import { agentProfileControllerChangeEligibilityQueryOptions } from "#/query/profiles/primary-binding";

export function AgentProfileWorkingFolderRecoveryAction(input: {
	className?: string;
	actorProfileId: string | null;
	organizationId: string;
	storageScope: string;
	onProfileUpdated: (profile: AuthProfileView) => void;
	profile: AuthProfileView;
}) {
	const [open, setOpen] = useState(false);
	const [savedStatus, setSavedStatus] = useState<string | null>(null);
	// This is the folder draft's frozen target, not a replacement for Core's
	// current readiness. Refreshes must neither reset it nor retarget the draft.
	const [draftTarget, setDraftTarget] = useState<{
		target: PeopleComputerTarget;
		agentControllerRef: string | null;
		bindingTarget: AgentProfileBindingTarget;
	} | null>(null);
	const readiness = useQuery({
		...agentExecutionReadinessBatchQueryOptions({
			agentProfileIds: [input.profile.openMeldProfileId],
			enabled: open,
			organizationId: input.organizationId,
			storageScope: input.storageScope,
		}),
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
	const eligibility = useQuery({
		...agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: input.profile.openMeldProfileId,
			enabled: open,
			organizationId: input.organizationId,
			storageScope: input.storageScope,
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
	const bindingTarget = projectAgentProfileBindingTarget(
		current?.primaryBinding
	);
	useEffect(() => {
		if (!open) {
			setDraftTarget(null);
			return;
		}
		if (
			!(draftTarget || loading || readiness.isError || eligibility.isError) &&
			target &&
			bindingTarget &&
			eligibility.data
		) {
			setDraftTarget({
				target,
				agentControllerRef: current?.agentControllerRef ?? null,
				bindingTarget,
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
		bindingTarget,
	]);
	const saveBlockedReason = resolveFolderDraftBlockReason({
		draftTarget,
		currentTarget: target,
		currentAgentControllerRef: current?.agentControllerRef ?? null,
		currentBindingTarget: bindingTarget,
		checking: loading,
		failed: readiness.isError || eligibility.isError,
	});
	const checkSavedFolder = async () => {
		setSavedStatus("Working folder saved. Checking Agent availability…");
		try {
			const result = await readiness.refetch({ throwOnError: true });
			const item = result.data?.items.find(
				(entry) => entry.agentProfileId === input.profile.openMeldProfileId
			);
			setSavedStatus(
				item?.agentWakeAvailability.status === "available_for_wake"
					? "Working folder saved. This Agent is available for new work. Retry the failed task when you are ready."
					: "Working folder saved. This Agent still needs attention. Review its current status before retrying the task."
			);
		} catch {
			setSavedStatus(
				"Working folder saved, but Agent availability could not be checked. Check again before retrying the task."
			);
		}
	};
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
			{savedStatus ? (
				<div className="grid gap-2">
					<output className="text-sm">{savedStatus}</output>
					<Button onClick={checkSavedFolder} size="sm" variant="ghost">
						Check again
					</Button>
				</div>
			) : null}
			{draftTarget ? (
				<AgentProfileProjectSettingsDialog
					actorProfileId={input.actorProfileId}
					agentControllerRef={draftTarget.agentControllerRef}
					executionTargetChangeEligibilityStatus={
						eligibility.data?.status ?? "unavailable"
					}
					expectedBindingTarget={draftTarget.bindingTarget}
					onOpenChange={setOpen}
					onProfileUpdated={input.onProfileUpdated}
					onSaved={checkSavedFolder}
					open={open}
					organizationId={input.organizationId}
					profile={input.profile}
					recoveryMessage={`This Agent could not use its working folder on ${current?.runtimeDeviceDisplayName ?? "its computer"}. Restore the original folder or choose one for new work. This does not move files or restart the failed task.`}
					saveBlockedReason={saveBlockedReason}
					storageScope={input.storageScope}
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
		bindingTarget: AgentProfileBindingTarget;
	} | null;
	currentTarget: PeopleComputerTarget | null;
	currentAgentControllerRef: string | null;
	currentBindingTarget: AgentProfileBindingTarget | null;
	checking: boolean;
	failed: boolean;
}): string | undefined {
	if (!input.draftTarget) {
		return undefined;
	}
	if (input.checking) {
		return "Checking this Agent’s current Computer…";
	}
	if (input.failed || !input.currentTarget || !input.currentBindingTarget) {
		return "Couldn’t confirm this Agent’s current Computer. Your changes are still here. Close and reopen Working folder to try again.";
	}
	if (
		input.currentTarget.deviceId !== input.draftTarget.target.deviceId ||
		input.currentTarget.runtimeLane !== input.draftTarget.target.runtimeLane ||
		input.currentAgentControllerRef !== input.draftTarget.agentControllerRef ||
		JSON.stringify(input.currentBindingTarget) !==
			JSON.stringify(input.draftTarget.bindingTarget)
	) {
		return "This Agent’s Computer or local agent changed. Close and reopen Working folder to review its current settings.";
	}
	return undefined;
}
