import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentsPath,
	buildOrganizationFilesPath,
	buildOrganizationPeoplePath,
	buildOrganizationPluginsPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";

const TEAM_VIEWS = [
	{ id: "people", label: "People", destination: buildOrganizationPeoplePath },
	{ id: "agents", label: "Agents", destination: buildOrganizationAgentsPath },
	{ id: "files", label: "Files", destination: buildOrganizationFilesPath },
	{ id: "skills", label: "Skills", destination: buildOrganizationSkillsPath },
	{
		id: "plugins",
		label: "Plugins",
		destination: buildOrganizationPluginsPath,
	},
] as const;

export function TeamHeader(input: {
	active: (typeof TEAM_VIEWS)[number]["id"];
	actions?: ReactNode;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const router = useRouter();
	const preload = (index: number) => {
		const view = TEAM_VIEWS[index];
		if (!view || view.id === input.active) {
			return;
		}
		router
			.preloadRoute({
				to: view.destination(currentOrganization.slug),
				search: {},
				hash: "",
			})
			.catch(console.error);
	};
	return (
		<SpaceWindowHeader
			actions={input.actions}
			leadingControl={
				<UsersThreeIcon className="size-4 text-muted-foreground" />
			}
			navigation={
				<TabsSubtle
					aria-label="Team view"
					className="h-full shrink-0 gap-5"
					idPrefix="team-directory"
					onSelect={(index) => {
						const view = TEAM_VIEWS[index];
						if (!view) {
							return;
						}
						navigate({
							to: view.destination(currentOrganization.slug),
							search: {},
							hash: "",
						}).catch(console.error);
					}}
					selectedIndex={TEAM_VIEWS.findIndex(
						(view) => view.id === input.active
					)}
					variant="underline"
				>
					{TEAM_VIEWS.map((view, index) => (
						<TabsSubtleItem
							index={index}
							key={view.id}
							label={view.label}
							labelClassName="text-sm"
							onFocus={() => preload(index)}
							onPointerEnter={() => preload(index)}
						/>
					))}
				</TabsSubtle>
			}
			renderFrame={false}
			title="Team"
		/>
	);
}
