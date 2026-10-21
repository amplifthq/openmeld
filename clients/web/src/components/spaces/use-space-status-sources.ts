import { useQuery } from "@tanstack/react-query";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { spaceInboxSummaryQueryOptions } from "#/query/organizations/inbox";
import type { SpaceStatusSources } from "./space-status-indicators";
import { useSpaceListIndicators } from "./use-space-list-indicators";

/**
 * The same unread, active work and Inbox attention evidence the
 * conversations sidebar reads, for surfaces outside it (the chat title).
 * Shares the sidebar's queries, so it adds no requests of its own.
 */
export function useSpaceStatusSources(input: {
	currentSpaceId: string;
	spaceIds: readonly string[];
}): SpaceStatusSources {
	const { currentOrganization: organization } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const indicators = useSpaceListIndicators({
		currentProfileId: profileId,
		currentSpaceId: input.currentSpaceId,
		organizationId: organization.id,
		spaceIds: input.spaceIds,
	});
	const inbox = useQuery(
		spaceInboxSummaryQueryOptions({ organizationId: organization.id })
	);
	return {
		unreadBySpaceId: indicators.unreadBySpaceId,
		activeWakeSummaryBySpaceId: indicators.activeWakeSummaryBySpaceId,
		attentionById: new Map(
			(inbox.data?.attention ?? []).map((item) => [item.spaceId, item])
		),
	};
}
