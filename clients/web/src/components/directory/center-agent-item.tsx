import { Badge } from "@openmeld/ui/components/badge";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { SidebarMenuButton } from "@openmeld/ui/fluid/sidebar-menu";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { CloudIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AgentCard } from "#/components/agents/agent-card";
import { RemoteAgentAvatar } from "#/components/agents/remote-agent-avatar";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { resolveDesignatedCenterAgentProfile } from "#/components/organizations/center-agent-profile-presentation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export function CenterAgentItem(input: { presentation?: "card" | "sidebar" }) {
	const { currentOrganization } = useAppOrganization();
	const { dismiss } = useAppNavigationPresentation();
	const designation = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const profile = resolveDesignatedCenterAgentProfile({
		agentProfiles: directory.data?.agentProfiles ?? [],
		designation: designation.data?.designation ?? null,
	});
	// A read still loading or refreshing toward the Center Agent is shown as
	// loading; only a settled answer (or a failure) may read as unavailable.
	const settledWithoutProfile = !(
		profile ||
		designation.isFetching ||
		directory.isFetching ||
		designation.isPending ||
		directory.isPending
	);
	if (!(profile || settledWithoutProfile)) {
		return (
			<SkeletonRegion
				className={
					input.presentation === "card" ? "rounded-md bg-card p-4" : "px-2 py-1"
				}
				label="Loading Center Agent"
			>
				<div className="flex items-center gap-2">
					<Skeleton
						className={
							input.presentation === "card"
								? "size-12 shrink-0 rounded-full"
								: "size-6 shrink-0 rounded-full"
						}
					/>
					<Skeleton className="h-3 w-28 max-w-full" />
				</div>
				{input.presentation === "card" ? (
					<Skeleton className="mt-4 h-3 w-2/3" />
				) : null}
			</SkeletonRegion>
		);
	}
	if (!profile) {
		// No designation yet: the Center Agent is set up when it is first
		// opened, so there is nothing to report as unavailable.
		if (
			designation.isSuccess &&
			!designation.data?.designation &&
			!directory.isError
		) {
			return null;
		}
		return (
			<p className="px-2 text-muted-foreground text-xs">
				Center Agent unavailable
			</p>
		);
	}
	if (input.presentation === "card") {
		const hasBotAvatar = Boolean(
			profile.avatarStyle &&
				profile.avatarStyle !== "automatic" &&
				profile.avatarStyle !== "fluid"
		);
		return (
			<FluidCardGroup>
				<AgentCard
					badge={
						<Badge
							className={cn(
								surfaceClasses(2),
								"absolute top-2 right-2 h-4 gap-1 px-1.5 py-0 text-[10px] [&>svg]:size-2.5!"
							)}
							variant="secondary"
						>
							<CloudIcon aria-hidden="true" />
							Center Agent
						</Badge>
					}
					description={`Owned by ${currentOrganization.name}`}
					interactiveAvatar={hasBotAvatar}
					name={profile.profileName}
					profileId={profile.profileId}
					renderAvatar={(size) => (
						<RemoteAgentAvatar
							avatarStyle={profile.avatarStyle}
							clickable={hasBotAvatar}
							followPointer
							profileId={profile.profileId}
							profileName={profile.profileName}
							shape="circle"
							size={size}
						/>
					)}
					to={`/o/${currentOrganization.slug}/chats/center-agent`}
				/>
			</FluidCardGroup>
		);
	}
	return (
		<FluidNavMenu activeValue={null} aria-label="Center Agent">
			<FluidNavMenuItem index={0} value={profile.profileId}>
				<SidebarMenuButton asChild className="h-auto">
					<Link
						aria-label={`Open ${profile.profileName}`}
						className="flex min-w-0 items-center gap-1.5 py-1"
						onClick={dismiss}
						params={{ orgSlug: currentOrganization.slug }}
						to="/o/$orgSlug/chats/center-agent"
					>
						<RemoteAgentAvatar
							avatarStyle={profile.avatarStyle}
							profileId={profile.profileId}
							profileName={profile.profileName}
							shape="circle"
							size={24}
						/>
						<span className="truncate font-medium text-[13px]">
							{profile.profileName}
						</span>
					</Link>
				</SidebarMenuButton>
			</FluidNavMenuItem>
		</FluidNavMenu>
	);
}
