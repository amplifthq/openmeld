"use client";

import type {
	AgentProfileBindingTarget,
	AgentWakeAvailabilityStatus,
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
import {
	hasWorkingFolderDialogHost,
	openWorkingFolderDialog,
	syncWorkingFolderDialogRequest,
	WorkingFolderDialogHost,
	type WorkingFolderDialogRequest,
} from "./working-folder-dialog-host";

type FolderDraftTarget = {
	target: PeopleComputerTarget;
	agentControllerRef: string | null;
	bindingTarget: AgentProfileBindingTarget;
};

/**
 * Opens the Working folder dialog for an Agent whose readiness points at its
 * folder. The surfaces showing this action follow readiness and can unmount
 * at any time, so the dialog itself is rendered by the app-level host.
 */
export function AgentProfileWorkingFolderRecoveryAction(
	input: WorkingFolderDialogRequest & {
		className?: string;
		label?: string;
	}
) {
	const { className, label, ...request } = input;
	// Read while the fix is on screen, so the dialog opens in its final layout.
	// Cached reads only: this action comes and goes with readiness, and a
	// fresh read on every mount would itself flip readiness to "Checking".
	useWorkingFolderDialogData(request, { fresh: false });
	// Without an app-level host (outside the app shell), the dialog stays here.
	const [localOpen, setLocalOpen] = useState(false);
	const [localMounted, setLocalMounted] = useState(false);
	useEffect(() => {
		syncWorkingFolderDialogRequest(request);
	});
	return (
		<>
			<Button
				className={className}
				onClick={() => {
					if (hasWorkingFolderDialogHost()) {
						openWorkingFolderDialog(request);
						return;
					}
					setLocalMounted(true);
					setLocalOpen(true);
				}}
				size="sm"
				variant="outline"
			>
				{label ??
					(request.folderMissing
						? "Choose working folder"
						: "Review working folder")}
			</Button>
			{localMounted ? (
				<AgentProfileWorkingFolderDialog
					onOpenChange={setLocalOpen}
					onOpenChangeComplete={(open) => {
						if (!open) {
							setLocalMounted(false);
						}
					}}
					open={localOpen}
					request={request}
				/>
			) : null}
		</>
	);
}

/** Mount once inside the app shell, where every Working folder action opens. */
export function AgentProfileWorkingFolderDialogHost() {
	return <WorkingFolderDialogHost dialog={AgentProfileWorkingFolderDialog} />;
}

/** The reads the dialog needs, shared with the action so they are cached. */
function useWorkingFolderDialogData(
	request: WorkingFolderDialogRequest,
	options: { fresh: boolean }
) {
	const profileId = request.profile.openMeldProfileId;
	const readiness = useQuery({
		...agentExecutionReadinessBatchQueryOptions({
			agentProfileIds: [profileId],
			enabled: true,
			organizationId: request.organizationId,
			storageScope: request.storageScope,
		}),
		// The dialog confirms the Agent's current Computer when it opens.
		...(options.fresh
			? { refetchOnMount: "always" as const, staleTime: 0 }
			: { refetchOnMount: false }),
		refetchOnWindowFocus: false,
	});
	const eligibility = useQuery({
		...agentProfileControllerChangeEligibilityQueryOptions({
			agentProfileId: profileId,
			enabled: true,
			organizationId: request.organizationId,
			storageScope: request.storageScope,
		}),
		refetchOnWindowFocus: false,
	});
	const current = readiness.data?.items.find(
		(item) => item.agentProfileId === profileId
	);
	const target =
		current?.routeDeviceId && current.routeLane
			? { deviceId: current.routeDeviceId, runtimeLane: current.routeLane }
			: null;
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
			organizationId: request.organizationId,
			profileId,
			storageScope: request.storageScope,
		})
	);
	useQuery(
		agentProfileWorkingFolderQueryOptions({
			actorProfileId: request.actorProfileId,
			enabled: readyDraftTarget !== null,
			expectedBindingTarget: readyDraftTarget?.bindingTarget,
			organizationId: request.organizationId,
			profileId,
			storageScope: request.storageScope,
			target: readyDraftTarget?.target,
		})
	);
	return {
		bindingTarget,
		current,
		eligibility,
		readiness,
		readyDraftTarget,
		target,
	};
}

function AgentProfileWorkingFolderDialog(input: {
	onOpenChange: (open: boolean) => void;
	onOpenChangeComplete: (open: boolean) => void;
	open: boolean;
	request: WorkingFolderDialogRequest;
}) {
	const { request } = input;
	const data = useWorkingFolderDialogData(request, { fresh: true });
	const { current, eligibility, readiness, target, bindingTarget } = data;
	// The folder draft's frozen target, taken when the dialog opens, not a
	// replacement for Core's current readiness. Refreshes must neither reset
	// it nor retarget the draft.
	const [draftTarget, setDraftTarget] = useState<FolderDraftTarget | null>(
		() => data.readyDraftTarget
	);
	// Opened before the reads finished: freeze the target once they have.
	if (!draftTarget && data.readyDraftTarget && input.open) {
		setDraftTarget(data.readyDraftTarget);
	}
	const loading =
		readiness.isPending ||
		eligibility.isPending ||
		readiness.isFetching ||
		eligibility.isFetching;
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
	const afterFailedTask = !(request.folderMissing || request.fromReadiness);
	const device = current?.runtimeDeviceDisplayName ?? "its computer";
	let recoveryMessage = `This Agent could not use its working folder on ${device}. Set up its folder again or choose another one for new work. This does not move files or restart the failed task.`;
	if (request.folderMissing) {
		recoveryMessage = `Choose the folder on ${device} where this Agent starts new work.`;
	} else if (request.fromReadiness) {
		recoveryMessage = `This Agent can’t use its working folder on ${device}. It may have been moved or deleted. Set it up again or choose another folder for new work. This does not move files.`;
	}
	// The fix usually clears the problem, so the action that opened this goes
	// away. The check and its result go through the query client and one
	// toast, updated in place.
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
						agentProfileIds: [request.profile.openMeldProfileId],
						enabled: true,
						organizationId: request.organizationId,
						storageScope: request.storageScope,
					}),
					staleTime: 0,
				})
			);
			status =
				items.find(
					(entry) => entry.agentProfileId === request.profile.openMeldProfileId
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
		// One dialog from the first frame: while the Agent's Computer is read
		// it shows its loading layout, not a separate dialog.
		<AgentProfileFoldersDialog
			actorProfileId={request.actorProfileId}
			agentControllerRef={
				draftTarget?.agentControllerRef ?? current?.agentControllerRef ?? null
			}
			executionTargetChangeEligibilityStatus={
				eligibility.data?.status ?? "unavailable"
			}
			expectedBindingTarget={draftTarget?.bindingTarget}
			onOpenChange={input.onOpenChange}
			onOpenChangeComplete={input.onOpenChangeComplete}
			onProfileUpdated={request.onProfileUpdated}
			open={input.open}
			organizationId={request.organizationId}
			preparing={
				draftTarget
					? undefined
					: {
							failed: !loading,
							onRetry: () => {
								Promise.all([readiness.refetch(), eligibility.refetch()]).catch(
									(error: unknown) => {
										console.error(
											"Failed to reload working-folder settings.",
											error
										);
									}
								);
							},
						}
			}
			profile={request.profile}
			recovery={{
				message: recoveryMessage,
				onSaved: checkSavedFolder,
				saveBlockedReason,
			}}
			storageScope={request.storageScope}
			target={draftTarget?.target}
		/>
	);
}

function resolveFolderDraftTarget(input: {
	agentControllerRef: string | null;
	bindingTarget: AgentProfileBindingTarget | null;
	target: PeopleComputerTarget | null;
}): FolderDraftTarget | null {
	return input.target && input.bindingTarget
		? {
				agentControllerRef: input.agentControllerRef,
				bindingTarget: input.bindingTarget,
				target: input.target,
			}
		: null;
}

function resolveFolderDraftBlockReason(input: {
	draftTarget: FolderDraftTarget | null;
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
