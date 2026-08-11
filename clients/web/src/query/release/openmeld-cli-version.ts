import { queryOptions } from "@tanstack/react-query";
import {
	type OpenMeldCliLatestRelease,
	readOpenMeldCliLatestRelease,
} from "#/lib/release/openmeld-cli-release";
import { baseQueryOptions } from "#/query/query-config";

export const releaseQueryKeys = {
	openMeldCliLatest: ["release", "openmeld-cli", "latest"] as const,
} as const;

export function openMeldCliLatestReleaseQueryOptions(input: {
	enabled: boolean;
}) {
	return queryOptions<OpenMeldCliLatestRelease, Error>({
		queryKey: releaseQueryKeys.openMeldCliLatest,
		queryFn: async () => await readOpenMeldCliLatestRelease(),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 60 * 1000,
		refetchOnMount: true,
		refetchOnWindowFocus: false,
	});
}
