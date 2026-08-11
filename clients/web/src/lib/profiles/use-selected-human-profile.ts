"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	findActiveProfileById,
	listActiveProfilesByKind,
} from "#/lib/profiles/human-profiles";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

type UseSelectedHumanProfileInput = {
	selectDefaultWhenMissing?: boolean;
	selectedHumanProfileId?: string | null;
	syncMissingSelectionToStartFlow?: boolean;
};

export function useSelectedHumanProfile(input?: UseSelectedHumanProfileInput) {
	const { state, storageScope, dispatch } = useStartFlowState();
	const selectedHumanProfileId =
		input?.selectedHumanProfileId === undefined
			? state.selectedHumanProfileId
			: input.selectedHumanProfileId;
	const selectDefaultWhenMissing = input?.selectDefaultWhenMissing === true;
	const syncMissingSelectionToStartFlow =
		input?.syncMissingSelectionToStartFlow ??
		(input?.selectedHumanProfileId === undefined && !selectDefaultWhenMissing);
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: selectedHumanProfileId !== null || selectDefaultWhenMissing,
			storageScope,
		})
	);

	const selectedHumanProfile = useMemo(() => {
		if (selectedHumanProfileId) {
			return findActiveProfileById(profilesQuery.data ?? [], {
				profileId: selectedHumanProfileId,
				profileKind: "human",
			});
		}

		if (!selectDefaultWhenMissing) {
			return null;
		}

		return (
			listActiveProfilesByKind(profilesQuery.data ?? [], "human")[0] ?? null
		);
	}, [profilesQuery.data, selectDefaultWhenMissing, selectedHumanProfileId]);

	useEffect(() => {
		if (
			!syncMissingSelectionToStartFlow ||
			selectedHumanProfileId === null ||
			profilesQuery.isPending ||
			profilesQuery.isError ||
			selectedHumanProfile !== null
		) {
			return;
		}

		dispatch({
			type: "set_selected_human_profile_id",
			selectedHumanProfileId: null,
		});
	}, [
		dispatch,
		profilesQuery.isError,
		profilesQuery.isPending,
		selectedHumanProfile,
		selectedHumanProfileId,
		syncMissingSelectionToStartFlow,
	]);

	const hasPendingSelectedHumanProfile =
		(selectedHumanProfileId !== null || selectDefaultWhenMissing) &&
		profilesQuery.isPending;
	const hasActiveSelectedHumanProfile = selectedHumanProfile !== null;
	const canContinueWithSelectedHumanProfile =
		hasPendingSelectedHumanProfile || hasActiveSelectedHumanProfile;
	const resolvedSelectedHumanProfileId =
		selectedHumanProfile?.openMeldProfileId ?? selectedHumanProfileId;

	return {
		activeSelectedHumanProfileId:
			selectedHumanProfile?.openMeldProfileId ?? null,
		canContinueWithSelectedHumanProfile,
		hasActiveSelectedHumanProfile,
		hasPendingSelectedHumanProfile,
		selectedHumanProfileId: resolvedSelectedHumanProfileId,
		selectedHumanProfile,
		profilesQuery,
	};
}
