import { FluidNavMenu, FluidNavMenuItem } from "@openmeld/ui/fluid/nav-menu";
import { SidebarMenuButton } from "@openmeld/ui/fluid/sidebar-menu";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useAppNavigationPresentation } from "#/components/app/app-navigation-presentation";
import { resolveDesignatedCenterAgentProfile } from "#/components/organizations/center-agent-profile-presentation";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export function CenterAgentSidebarItem() {
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
						<DitherProfileAvatar
							profileId={profile.profileId}
							profileKind="center-agent"
							profileName={profile.profileName}
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
