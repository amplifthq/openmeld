import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
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

const TEAM_VIEWS = ["people", "agents", "plugins", "skills", "files"] as const;
const TEAM_DESTINATIONS = [
	buildOrganizationPeoplePath,
	buildOrganizationAgentsPath,
	buildOrganizationPluginsPath,
	buildOrganizationSkillsPath,
	buildOrganizationFilesPath,
] as const;

export function TeamHeader(input: {
	active: (typeof TEAM_VIEWS)[number];
	actions?: ReactNode;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
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
						const destination = TEAM_DESTINATIONS[index];
						if (!destination) {
							return;
						}
						navigate({
							to: destination(currentOrganization.slug),
							search: {},
							hash: "",
						}).catch(console.error);
					}}
					selectedIndex={TEAM_VIEWS.indexOf(input.active)}
					variant="underline"
				>
					<TabsSubtleItem index={0} label="People" labelClassName="text-sm" />
					<TabsSubtleItem index={1} label="Agents" labelClassName="text-sm" />
					<TabsSubtleItem index={2} label="Plugins" labelClassName="text-sm" />
					<TabsSubtleItem index={3} label="Skills" labelClassName="text-sm" />
					<TabsSubtleItem index={4} label="Files" labelClassName="text-sm" />
				</TabsSubtle>
			}
			renderFrame={false}
			title="Team"
		/>
	);
}
