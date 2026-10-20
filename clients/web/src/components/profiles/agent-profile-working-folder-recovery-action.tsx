"use client";

import type {
	AgentProfileBindingTarget,
	AgentWakeAvailabilityStatus,
	AuthProfileView,
	GetAgentExecutionReadinessBatchResponse,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AgentProfileFoldersDialog } from "#/components/profiles/agent-profile-folders-dialog";
import { projectAgentProfileBindingTarget } from "#/lib/profiles/agent-profile-primary-binding";
import { agentExecutionReadinessBatchQueryOptions } from "#/query/agents/execution-readiness";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";
import { agentProfileControllerChangeEligibilityQueryOptions } from "#/query/profiles/primary-binding";
import { agentProfileWorkingFolderQueryOptions } from "#/query/profiles/working-folder";

export function AgentProfileWorkingFolderRecoveryAction(input: {
	className?: string;
	actorProfileId: string | null;
	/** No folder is set yet, so nothing has failed: ask to choose one. */
	folderMissing?: boolean;
	/** Shown for the Agent's current readiness, not after a failed task. */
	fromReadiness?: boolean;
	label?: string;
	organizationId: string;
	storageScope: string;
	onProfileUpdated: (profile: AuthProfileView) => void;
	profile: AuthProfileView;
}) {
	const [open, setOpen] = useState(false);
	// This is the folder draft's frozen target, not a replacement for Core's
	// current readiness. Refreshes must neither reset it nor retarget the draft.
	const [draftTarget, setDraftTarget] = useState<{
		target: PeopleComputerTarget;
		agentControllerRef: string | null;
		bindingTarget: AgentProfileBindingTarget;
	} | null>(null);
	// Read while the fix is on screen, not only once it is clicked, so the
	// dialog opens in its final layout instead of loading in front of the user.
	const readiness = useQuery({
		...agentExecutionReadinessBatchQueryOptions({
			agentProfileIds: [input.profile.openMeldProfileId],
			enabled: true,
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
			enabled: true,
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
	const readyDraftTarget =
		readiness.isError || eligibility.isError || !eligibility.data
			? null
			: resolveFolderDraftTarget({
					agentControllerRef: current?.agentControllerRef ?? null,
					bindingTarget,
					target,
				});
	// The dialog's folder list and default path, read ahead with the keys
	// the dialog itself uses.
	useQuery(
		agentProfileFoldersQueryOptions({
			enabled: readyDraftTarget !== null,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
			storageScope: input.storageScope,
		})
	);
	useQuery(
		agentProfileWorkingFolderQueryOptions({
			actorProfileId: input.actorProfileId,
			enabled: readyDraftTarget !== null,
			expectedBindingTarget: readyDraftTarget?.bindingTarget,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
			storageScope: input.storageScope,
			target: readyDraftTarget?.target,
		})
	);
	useEffect(() => {
		// Opened before the reads finished: freeze the target once they have.
		if (open && !draftTarget && readyDraftTarget) {
			setDraftTarget(readyDraftTarget);
		}
	}, [open, draftTarget, readyDraftTarget]);
	const saveBlockedReason = resolveFolderDraftBlockReason({
		draftTarget,
		currentTarget: target,
		currentAgentControllerRef: current?.agentControllerRef ?? null,
		currentBindingTarget: bindingTarget,
		// A background refresh doesn't pause writes or post a note: the Service
		// still checks the expected binding on every write.
		checking: readiness.isPending || eligibility.isPending,
		failed: readiness.isError || eligibility.isError,
	});
	const queryClient = useQueryClient();
	const afterFailedTask = !(input.folderMissing || input.fromReadiness);
	const device = current?.runtimeDeviceDisplayName ?? "its computer";
	let recoveryMessage = `This Agent could not use its working folder on ${device}. Set up its folder again or choose another one for new work. This does not move files or restart the failed task.`;
	if (input.folderMissing) {
		recoveryMessage = `Choose the folder on ${device} where this Agent starts new work.`;
	} else if (input.fromReadiness) {
		recoveryMessage = `This Agent can’t use its working folder on ${device}. It may have been moved or deleted. Set it up again or choose another folder for new work. This does not move files.`;
	}
	// The fix usually clears the problem, so this action unmounts with the card
	// or footer that showed it. The check and its result must not depend on
	// it: they go through the query client and one toast, updated in place.
	const checkSavedFolder = async (): Promise<void> => {
		const toastId = toast.loading(
			"Working folder saved. Checking availability…"
		);
		const checkAgain = {
			label: "Check again",
			onClick: () => {
				checkSavedFolder().catch(() => undefined);
			},
		};
		let status: AgentWakeAvailabilityStatus | null;
		try {
			const items = await waitForSettledWakeAvailability(() =>
				queryClient.fetchQuery({
					...agentExecutionReadinessBatchQueryOptions({
						agentProfileIds: [input.profile.openMeldProfileId],
						enabled: true,
						organizationId: input.organizationId,
						storageScope: input.storageScope,
					}),
					staleTime: 0,
				})
			);
			status =
				items.find(
					(entry) => entry.agentProfileId === input.profile.openMeldProfileId
				)?.agentWakeAvailability.status ?? null;
		} catch {
			toast.warning(
				afterFailedTask
					? "Working folder saved, but Agent availability could not be checked. Check again before retrying the task."
					: "Working folder saved, but Agent availability could not be checked.",
				{ action: checkAgain, id: toastId }
			);
			return;
		}
		if (status === "available_for_wake") {
			toast.success(
				afterFailedTask
					? "Working folder saved. This Agent is available for new work. Retry the failed task when you are ready."
					: "Working folder saved. This Agent is ready for new work.",
				{ id: toastId }
			);
			return;
		}
		if (status === "checking_connection" || status === null) {
			// Still settling, not a problem: say so neutrally.
			toast.info(
				"Working folder saved. OpenMeld is still checking this Agent.",
				{ action: checkAgain, id: toastId }
			);
			return;
		}
		toast.warning(
			afterFailedTask
				? "Working folder saved. This Agent still needs attention. Review its current status before retrying the task."
				: "Working folder saved. This Agent still needs attention. Review its current status.",
			{ action: checkAgain, id: toastId }
		);
	};
	return (
		<>
			<Button
				className={input.className}
				onClick={() => {
					// Freeze the target from data already read, so the dialog's
					// first frame is its final layout.
					setDraftTarget(readyDraftTarget);
					setOpen(true);
				}}
				size="sm"
				variant="outline"
			>
				{input.label ??
					(input.folderMissing
						? "Choose working folder"
						: "Review working folder")}
			</Button>
			{/* One dialog from the first frame: while the Agent's Computer is read
			    it shows its loading layout, not a separate dialog. */}
			<AgentProfileFoldersDialog
				actorProfileId={input.actorProfileId}
				agentControllerRef={
					draftTarget?.agentControllerRef ?? current?.agentControllerRef ?? null
				}
				executionTargetChangeEligibilityStatus={
					eligibility.data?.status ?? "unavailable"
				}
				expectedBindingTarget={draftTarget?.bindingTarget}
				onOpenChange={setOpen}
				onOpenChangeComplete={(isOpen) => {
					// Cleared only once the dialog is gone, so it closes on the
					// content it showed.
					if (!isOpen) {
						setDraftTarget(null);
					}
				}}
				onProfileUpdated={input.onProfileUpdated}
				open={open}
				organizationId={input.organizationId}
				preparing={
					draftTarget
						? undefined
						: {
								failed: !loading,
								onRetry: () => {
									Promise.all([
										readiness.refetch(),
										eligibility.refetch(),
									]).catch((error: unknown) => {
										console.error(
											"Failed to reload working-folder settings.",
											error
										);
									});
								},
							}
				}
				profile={input.profile}
				recovery={{
					message: recoveryMessage,
					onSaved: checkSavedFolder,
					saveBlockedReason,
				}}
				storageScope={input.storageScope}
				target={draftTarget?.target}
			/>
		</>
	);
}

function resolveFolderDraftTarget(input: {
	agentControllerRef: string | null;
	bindingTarget: AgentProfileBindingTarget | null;
	target: PeopleComputerTarget | null;
}): {
	target: PeopleComputerTarget;
	agentControllerRef: string | null;
	bindingTarget: AgentProfileBindingTarget;
} | null {
	return input.target && input.bindingTarget
		? {
				agentControllerRef: input.agentControllerRef,
				bindingTarget: input.bindingTarget,
				target: input.target,
			}
		: null;
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

const SETTLE_CHECK_ATTEMPTS = 6;
const SETTLE_CHECK_INTERVAL_MS = 2000;

/**
 * Readiness right after a save is often still "checking". Reads it a few
 * times, briefly, until it settles; returns the last read either way.
 */
async function waitForSettledWakeAvailability(
	read: () => Promise<GetAgentExecutionReadinessBatchResponse>
): Promise<GetAgentExecutionReadinessBatchResponse["items"]> {
	let items: GetAgentExecutionReadinessBatchResponse["items"] = [];
	for (let attempt = 0; attempt < SETTLE_CHECK_ATTEMPTS; attempt += 1) {
		if (attempt > 0) {
			await new Promise((resolve) =>
				setTimeout(resolve, SETTLE_CHECK_INTERVAL_MS)
			);
		}
		items = (await read()).items;
		const settled = items.every(
			(item) => item.agentWakeAvailability.status !== "checking_connection"
		);
		if (items.length > 0 && settled) {
			return items;
		}
	}
	return items;
}
