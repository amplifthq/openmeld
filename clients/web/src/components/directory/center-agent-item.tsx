import { Badge } from "@openmeld/ui/components/badge";
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
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";

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
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const profile = resolveDesignatedCenterAgentProfile({
		agentProfiles: directory.data?.agentProfiles ?? [],
		designation: designation.data?.designation ?? null,
	});
	if (designation.isPending || directory.isPending) {
		return (
			<p className="px-2 text-muted-foreground text-xs">
				Loading Center Agent…
			</p>
		);
	}
	if (!profile) {
		return (
			<p className="px-2 text-muted-foreground text-xs">
				Center Agent unavailable
			</p>
		);
	}
	if (input.presentation === "card") {
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
					name={profile.profileName}
					profileId={profile.profileId}
					renderAvatar={(size) => (
						<RemoteAgentAvatar
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
