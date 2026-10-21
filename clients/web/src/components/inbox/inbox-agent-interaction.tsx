import type {
	InboxItem,
	RespondToSpaceAgentInteractionBody,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ApprovalRequestUnavailable } from "#/components/inbox/approval-request-states";
import { SpaceAgentInteractionCard } from "#/components/spaces/space-agent-interaction-card";
import { buildInboxAgentInteractionConversationHref } from "#/lib/inbox/source-target";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { sendWebSpaceAgentInteractionResponse } from "#/lib/spaces/agent-interaction-response";
import { invalidateInboxFacts } from "#/query/organizations/inbox";
import { spaceActiveWakeProgressSummaryQueryOptions } from "#/query/spaces/active-wake-progress";

const PENDING_REFETCH_MS = 5000;

type AgentInteractionTarget = Extract<
	InboxItem["sourceTarget"],
	{ kind: "agent_interaction" }
>;

/**
 * An Agent's question, answered in Inbox with the harness's own options
 * (member-agent-program.md §4.6). The answer goes through the same Space
 * endpoint as the conversation, so answering anywhere closes it everywhere;
 * Core offers the options only to the Binding owner.
 */
export function InboxAgentInteraction(input: {
	target: AgentInteractionTarget;
}) {
	const { target } = input;
	const queryClient = useQueryClient();
	const organization = useOptionalAppOrganization();
	const orgSlug = organization?.currentOrganization.slug ?? "";
	const organizationId = organization?.currentOrganization.id ?? "";
	const { defaultHumanProfile, profilesQuery } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const progress = useQuery({
		...spaceActiveWakeProgressSummaryQueryOptions({
			enabled: Boolean(profileId),
			openMeldProfileId: profileId,
			spaceId: target.spaceId,
		}),
		// An answer from elsewhere ends the question here too.
		refetchInterval: (query) =>
			findPendingInteraction(query.state.data?.items, target)
				? PENDING_REFETCH_MS
				: false,
	});
	const item = findPendingInteraction(progress.data?.items, target);
	const respond = async (body: RespondToSpaceAgentInteractionBody) => {
		await sendWebSpaceAgentInteractionResponse({
			body,
			openMeldProfileId: profileId,
			spaceId: target.spaceId,
		});
		await Promise.all([
			progress.refetch(),
			organizationId
				? invalidateInboxFacts({ organizationId, queryClient })
				: Promise.resolve(),
		]);
	};
	const openConversation = (
		<Link
			className="inline-block text-muted-foreground text-xs hover:underline"
			to={buildInboxAgentInteractionConversationHref({ orgSlug, target })}
		>
			Open conversation
		</Link>
	);

	if (profilesQuery.isPending || (profileId && progress.isPending)) {
		return <SkeletonRows label="Loading the Agent's question" rows={3} />;
	}
	// A failed poll keeps the question already shown; only a first read that
	// fails has nothing to show.
	if (progress.isError && !progress.data) {
		return (
			<ApprovalRequestUnavailable
				message="This question could not be loaded. Refresh to try again."
				onRefresh={() => progress.refetch()}
				refreshLabel="Refresh question"
			>
				{openConversation}
			</ApprovalRequestUnavailable>
		);
	}
	if (!item?.pendingInteraction && progress.data?.pageInfo?.hasMore) {
		// A busy conversation lists only its newest work here.
		return (
			<div className="mt-3 space-y-2 rounded-md border border-border/70 p-4">
				<p className="text-muted-foreground text-sm">
					Answer this question in the conversation.
				</p>
				{openConversation}
			</div>
		);
	}
	if (!item?.pendingInteraction) {
		return (
			<div className="mt-3 space-y-2 rounded-md border border-border/70 p-4">
				<p className="text-muted-foreground text-sm">
					This question has been answered or has ended. Open the conversation to
					see what happened.
				</p>
				{openConversation}
			</div>
		);
	}
	return (
		<div className="space-y-2" data-slot="inbox-agent-interaction">
			{/* Framed like every other Inbox request (access, credentials, Plugin). */}
			<SpaceAgentInteractionCard item={item} onRespond={respond} />
			{openConversation}
		</div>
	);
}

function findPendingInteraction(
	items: readonly WakeProgressItem[] | undefined,
	target: AgentInteractionTarget
): WakeProgressItem | undefined {
	return items?.find(
		(candidate) =>
			candidate.runtimeCoordinatorExecutionId ===
				target.runtimeCoordinatorExecutionId &&
			candidate.pendingInteraction?.interactionId === target.interactionId
	);
}
