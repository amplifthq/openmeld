import { buttonVariants } from "@openmeld/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { OrganizationEntryIntent } from "#/lib/organizations/organization-entry-intent";
import {
	buildOrganizationNewOrganizationPath,
	buildOrganizationOrganizationsPath,
} from "#/lib/organizations/organization-routes";

export function PersonalWorkspaceOrganizationGuidance(input: {
	description: string;
	intent?: OrganizationEntryIntent;
}) {
	const { currentOrganization, organizations } = useAppOrganization();
	const search = input.intent ? { intent: input.intent } : {};
	return (
		<div className="space-y-4">
			<div className="space-y-2 text-muted-foreground text-sm/relaxed">
				<p>{input.description}</p>
				<p>
					Your Personal Workspace is just for you. Its Spaces, agents, and files
					stay here when you create or join an organization.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<Link
					className={buttonVariants({ size: "sm" })}
					search={search}
					to={buildOrganizationNewOrganizationPath(currentOrganization.slug)}
				>
					Create organization
				</Link>
				{organizations.some((organization) => !organization.isPersonal) ? (
					<Link
						className={buttonVariants({ size: "sm", variant: "outline" })}
						search={search}
						to={buildOrganizationOrganizationsPath(currentOrganization.slug)}
					>
						Choose organization
					</Link>
				) : null}
			</div>
		</div>
	);
}
