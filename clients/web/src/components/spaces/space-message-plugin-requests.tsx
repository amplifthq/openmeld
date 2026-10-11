import { Button } from "@openmeld/ui/components/button";
import { PluginActionRequest } from "#/components/inbox/plugin-action-request";
import { useMessagePluginActionRequests } from "#/query/organizations/plugin-action-requests";

export function SpaceMessagePluginRequests({
	spaceId,
	sourceSignalId,
	visibleSignalIds,
}: {
	spaceId: string;
	sourceSignalId: string;
	visibleSignalIds: string[];
}) {
	const query = useMessagePluginActionRequests(spaceId, visibleSignalIds);
	if (query.isError) {
		if (sourceSignalId !== visibleSignalIds.at(-1)) {
			return null;
		}
		return (
			<Button onClick={() => query.refetch()} size="sm" variant="ghost">
				Reload approval requests
			</Button>
		);
	}
	return (
		query.data?.requests
			.filter((request) => request.sourceSignalId === sourceSignalId)
			.map((request) => (
				<PluginActionRequest
					key={request.requestId}
					requestId={request.requestId}
				/>
			)) ?? null
	);
}
