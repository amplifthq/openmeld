import { buttonVariants } from "@openmeld/ui/components/button";
import { FolderSimplePlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationProjectsPath } from "#/lib/organizations/organization-routes";

export function AgentActivityEmptySetup() {
	const { currentOrganization } = useAppOrganization();
	return (
		<span className="inline-flex flex-col items-center gap-3 py-2">
			<span>No sessions yet. Create a Project to start reporting.</span>
			<Link
				className={buttonVariants({ size: "sm" })}
				to={buildOrganizationProjectsPath(currentOrganization.slug)}
			>
				<FolderSimplePlusIcon aria-hidden="true" /> Create Project
			</Link>
		</span>
	);
}
