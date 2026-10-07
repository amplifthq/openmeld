import type {
	ProfileDetailsRecoveryAction,
	SpaceInputQueueResponse,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
	formatMutationError,
	isAgentProfileWorkAwaitingOriginalStopError,
} from "#/components/agents/agents-page-formatters";
import { ProfileDetailsRecoveryActionButton } from "#/components/profiles/profile-details-recovery-action-button";
import { executeAgentProfileWorkRecovery } from "#/lib/profiles/agent-profile-work-recovery";
import {
	organizationAgentRuntimeOverviewQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";

/** Read the existing work owner; the composer does not own another task queue. */
export function useSpaceWorkRecovery(
	spaceId: string,
	requesterRecoveries: SpaceInputQueueResponse["recoveries"] = []
) {
	const context = useOptionalSpaceAgentProfileEditContext();
	const organizationId = context?.organizationId ?? "";
	const queryClient = useQueryClient();
	const overview = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: Boolean(organizationId && context?.profilesById.size),
			organizationId,
		})
	);
	const [pending, setPending] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [waitingWakeId, setWaitingWakeId] = useState<string | null>(null);
	const ownerRows = (overview.data?.agentProfiles ?? []).flatMap((agent) => {
		const work = agent.operationalContext;
		const profile = context?.profilesById.get(agent.profileId);
		if (
			!(
				profile &&
				work?.status === "paused" &&
				work.currentWorkLocation?.spaceId === spaceId &&
				work.recoveryAction &&
				work.recoveryTargetWakeLifecycleId
			)
		) {
			return [];
		}
		return [
			{
				profile: {
					openMeldProfileId: profile.openMeldProfileId,
					profileName: profile.profileName,
				},
				requester: false,
				action: {
					kind: work.recoveryAction,
					expectedInterruptedTargetWakeLifecycleId:
						work.recoveryTargetWakeLifecycleId,
					visibility: "owner_self" as const,
				},
			},
		];
	});
	const rows = [
		...ownerRows,
		...requesterRecoveries.map((recovery) => ({
			profile: {
				openMeldProfileId: recovery.targetProfileId,
				profileName: recovery.profileName,
			},
			requester: true,
			action: {
				kind: recovery.action,
				expectedInterruptedTargetWakeLifecycleId:
					recovery.expectedInterruptedTargetWakeLifecycleId,
				visibility: "requester_self" as const,
			},
		})),
	];
	async function recover(
		profileId: string,
		action: ProfileDetailsRecoveryAction,
		requester: boolean
	) {
		if (pending || !action.expectedInterruptedTargetWakeLifecycleId) {
			return;
		}
		setPending(profileId);
		setError(null);
		setWaitingWakeId(null);
		try {
			await executeAgentProfileWorkRecovery({
				agentProfileId: profileId,
				organizationId,
				...(requester ? { spaceId } : {}),
				action: action.kind,
				expectedInterruptedTargetWakeLifecycleId:
					action.expectedInterruptedTargetWakeLifecycleId,
			});
		} catch (cause) {
			if (isAgentProfileWorkAwaitingOriginalStopError(cause)) {
				setWaitingWakeId(action.expectedInterruptedTargetWakeLifecycleId);
			} else {
				setError(
					formatMutationError(cause, "Couldn't update this task. Try again.")
				);
			}
		} finally {
			await Promise.allSettled([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.agentRuntimeOverview(organizationId),
				}),
				queryClient.invalidateQueries({
					queryKey: ["space-input-queue", spaceId],
				}),
			]);
			setPending(null);
		}
	}
	return {
		visible: rows.length > 0 || error !== null,
		content: (
			<>
				{rows.map(({ profile, action, requester }) => (
					<div
						className="flex items-center gap-2 px-3 py-2 text-xs"
						key={profile.openMeldProfileId}
					>
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium">{profile.profileName}</p>
							<p className="text-muted-foreground">
								{action.kind === "fork_interrupted_work"
									? "Another app is using this conversation."
									: "This task needs your attention."}
							</p>
						</div>
						<ProfileDetailsRecoveryActionButton
							compact
							isPending={pending !== null}
							onRecoveryAction={(selected) =>
								recover(profile.openMeldProfileId, selected, requester)
							}
							recoveryAction={action}
						/>
					</div>
				))}
				{error ? (
					<p className="px-3 py-2 text-destructive text-xs" role="alert">
						{error}
					</p>
				) : null}
				{rows.some(
					({ action }) =>
						action.expectedInterruptedTargetWakeLifecycleId === waitingWakeId
				) ? (
					<output className="block px-3 py-2 text-muted-foreground text-xs">
						Your choice is saved. Waiting for the original request to stop.
					</output>
				) : null}
			</>
		),
	};
}
