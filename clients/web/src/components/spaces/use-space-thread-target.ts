import { useQuery } from "@tanstack/react-query";
import {
	resolveSpaceThreadTarget,
	type SpaceMessageTarget,
} from "#/lib/spaces/thread-navigation";
import { spaceHistoryQueryOptions } from "#/query/spaces/history";
import { spaceThreadsQueryOptions } from "#/query/spaces/threads";

export function useSpaceThreadTarget(
	input: SpaceMessageTarget & {
		spaceId: string;
		profileId: string;
	}
) {
	const catalog = useQuery(
		spaceThreadsQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: false,
		})
	);
	const history = useQuery(
		spaceHistoryQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: false,
		})
	);
	return resolveSpaceThreadTarget(
		catalog.data ?? history.data?.threadDisplay ?? undefined,
		input
	);
}
