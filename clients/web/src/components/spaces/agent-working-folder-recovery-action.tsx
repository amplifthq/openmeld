"use client";

import type { AuthProfileView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
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
			{!(loading || readiness.isError || eligibility.isError) &&
			target &&
			eligibility.data ? (
				<AgentProfileProjectSettingsDialog
					actorProfileId={input.context.actorProfileId}
					agentControllerRef={current?.agentControllerRef ?? null}
					currentWorkingFolder={null}
					executionTargetChangeEligibilityStatus={eligibility.data.status}
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
					target={target}
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
