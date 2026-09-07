import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useState } from "react";

export function usePluginConnectionSnapshotCurrent(input: {
	data: unknown;
	isError: boolean;
	isFetchedAfterMount: boolean;
	isFetching: boolean;
	isPaused: boolean;
	isStale: boolean;
}): boolean {
	const [acceptedFreshSnapshotAtMount] = useState(
		() => Boolean(input.data) && !input.isStale
	);
	return (
		Boolean(input.data) &&
		!input.isFetching &&
		!input.isPaused &&
		!input.isError &&
		(acceptedFreshSnapshotAtMount || input.isFetchedAfterMount)
	);
}

export function PluginAccessLoadingSkeleton() {
	return (
		<div
			aria-hidden="true"
			className="mt-4 max-w-md space-y-2"
			data-testid="plugin-access-loading-skeleton"
		>
			<Skeleton className="h-3 w-28" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}
