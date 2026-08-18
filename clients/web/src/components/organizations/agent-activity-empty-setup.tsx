import { buttonVariants } from "@openmeld/ui/components/button";
import { FolderOpenIcon, FolderSimplePlusIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationProjectsPath } from "#/lib/organizations/organization-routes";
import type { ActivitySetupState } from "./agent-activity-derive";

export function AgentActivityEmptySetup(input: {
	setupState: Exclude<ActivitySetupState, "active">;
}) {
	const { currentOrganization } = useAppOrganization();
	const noProjects = input.setupState === "no_projects";
	return (
		<span className="inline-flex max-w-xl flex-col items-center gap-1 py-2">
			<span className="font-medium text-foreground">
				{noProjects
					? "No Projects yet."
					: "Waiting for the first reported session."}
			</span>
			<span>
				{noProjects
					? "Create a Project before OpenMeld can report agent sessions."
					: "Confirm a folder is connected in Manage Projects, then start or continue a coding-agent session in that folder."}
			</span>
			<Link
				className={buttonVariants({ className: "mt-2", size: "sm" })}
				to={buildOrganizationProjectsPath(currentOrganization.slug)}
			>
				{noProjects ? (
					<FolderSimplePlusIcon aria-hidden="true" />
				) : (
					<FolderOpenIcon aria-hidden="true" />
				)}{" "}
				{noProjects ? "Create Project" : "Manage Projects"}
			</Link>
		</span>
	);
}
