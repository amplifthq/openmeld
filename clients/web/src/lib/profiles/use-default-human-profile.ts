"use client";

import { useQuery } from "@tanstack/react-query";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { findActiveDefaultHumanProfile } from "#/lib/profiles/human-profiles";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

export function useDefaultHumanProfile() {
	const { storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);

	return {
		defaultHumanProfile: findActiveDefaultHumanProfile(
			profilesQuery.data ?? []
		),
		profilesQuery,
	};
}
