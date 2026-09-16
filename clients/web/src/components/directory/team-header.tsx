import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { UsersThreeIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";

const TEAM_VIEWS = ["people", "agents", "plugins"] as const;

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
						navigate({
							to: `/o/${currentOrganization.slug}/${TEAM_VIEWS[index]}`,
						}).catch(console.error);
					}}
					selectedIndex={TEAM_VIEWS.indexOf(input.active)}
					variant="underline"
				>
					<TabsSubtleItem index={0} label="People" labelClassName="text-sm" />
					<TabsSubtleItem index={1} label="Agents" labelClassName="text-sm" />
					<TabsSubtleItem index={2} label="Plugins" labelClassName="text-sm" />
				</TabsSubtle>
			}
			renderFrame={false}
			title="Team"
		/>
	);
}
