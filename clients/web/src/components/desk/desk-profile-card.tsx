import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RemoteAgentIndicator } from "#/components/agents/remote-agent-indicator";
import { ProfileCardHeader } from "#/components/profiles/profile-card-header";
import { SpaceProfileIcon } from "#/components/spaces/space-profile-icon";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildAgentProfilePath,
	buildHumanProfilePath,
} from "#/lib/profile-routes";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { organizationSpaceProfileCandidatesQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

export function DeskProfileCard(input: {
	profileId: string;
	onCenter: () => void;
	onChat: (chat: { spaceId: string; profileId: string; title: string }) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const client = useQueryClient();
	const directory = useQuery({
		...organizationSpaceProfileCandidatesQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		}),
		refetchInterval: 15_000,
	});
	const agent = directory.data?.agentProfiles.find(
		(p) => p.profileId === input.profileId
	);
	const member = directory.data?.members.find(
		(p) => p.humanProfile?.profileId === input.profileId
	);
	const name =
		agent?.profileName ?? member?.humanProfile?.profileName ?? "Profile";
	const chat = useMutation({
		mutationFn: () =>
			openCurrentDirectMessageSpace({
				organizationId: currentOrganization.id,
				targetProfileId: input.profileId,
			}),
		onSuccess: async (response) => {
			await client.invalidateQueries({
				queryKey: accountSpaceQueryKeys.all,
				refetchType: "none",
			});
			input.onChat({
				spaceId: response.spaceId,
				profileId: response.memberProfileId,
				title: name,
			});
		},
	});
	if (directory.isPending) {
		return <output>Loading profile…</output>;
	}
	if (directory.isError) {
		return (
			<div role="alert">
				Couldn’t load this profile.{" "}
				<Button onClick={() => directory.refetch()} variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	if (!(agent || member)) {
		return <p>This profile is no longer available.</p>;
	}
	const isSelf = Boolean(member?.userId === currentUserId);
	const profileHref = (agent ? buildAgentProfilePath : buildHumanProfilePath)({
		orgSlug: currentOrganization.slug,
		profileId: input.profileId,
	});
	const work = agent?.operationalContext;
	return (
		<div className="grid min-w-0 @[34rem]/profile:grid-cols-[1fr_auto] @[34rem]/profile:items-center gap-3">
			<ProfileCardHeader
				avatar={
					<SpaceProfileIcon
						agentControllerRef={agent?.agentControllerRef ?? null}
						avatarImageUrl={agent?.avatarUrl ?? member?.avatarImageUrl}
						isCenterAgent={agent?.isCenterAgent}
						profileId={input.profileId}
						profileKind={agent ? "agent" : "human"}
						profileName={name}
						size="md"
					/>
				}
				badge={
					agent ? (
						<RemoteAgentIndicator
							agentControllerRef={agent.agentControllerRef}
						/>
					) : undefined
				}
				name={name}
			>
				<p className="mt-1 text-muted-foreground text-sm">
					{agent?.isCenterAgent
						? "Center Agent"
						: (agent?.ownerName ?? (isSelf ? "You" : "Person"))}
				</p>
				{agent && (
					<p className="mt-2 text-muted-foreground text-xs">
						{agent.readiness.agentWakeAvailability.badgeLabel}
					</p>
				)}
			</ProfileCardHeader>
			{work && work.status !== "idle" && work.status !== "checking" && (
				<div className="order-2 @[34rem]/profile:col-span-2 rounded-md bg-surface-1 p-3 text-sm">
					<p>
						{
							{
								checking: "Checking work…",
								working: "Working now",
								paused: "Paused",
							}[work.status]
						}
					</p>
					{"waitingCount" in work && work.waitingCount > 0 && (
						<p className="mt-1 text-muted-foreground text-xs">
							{work.waitingCount} queued
						</p>
					)}
				</div>
			)}
			<div className="flex flex-wrap gap-2">
				{!isSelf && (
					<Button
						aria-label={
							agent ? "Chat with this agent" : "Chat with this person"
						}
						disabled={chat.isPending}
						onClick={() =>
							agent?.isCenterAgent ? input.onCenter() : chat.mutate()
						}
						size="sm"
					>
						Chat
					</Button>
				)}
				<Link
					className={buttonVariants({ size: "sm", variant: "outline" })}
					to={profileHref}
				>
					View profile
				</Link>
			</div>
			{chat.isError && (
				<p
					className="order-3 @[34rem]/profile:col-span-2 text-destructive text-sm"
					role="alert"
				>
					{resolveDirectMessageOpenErrorMessage(chat.error)}
				</p>
			)}
		</div>
	);
}
