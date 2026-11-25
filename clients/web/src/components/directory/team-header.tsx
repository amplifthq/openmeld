import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";

export type TeamView = "members" | "topics";

export function TeamHeader(input: { active: TeamView; actions?: ReactNode }) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	return (
		<SpaceWindowHeader
			actions={input.actions}
			navigation={
				<TabsSubtle
					aria-label="Team view"
					className="h-full shrink-0 gap-5"
					idPrefix="team-directory"
					onSelect={(index) => {
						if (index === (input.active === "topics" ? 1 : 0)) {
							return;
						}
						navigate({
							to: buildOrganizationPeoplePath(currentOrganization.slug),
							search: index === 1 ? { view: "topics" } : {},
							hash: "",
						}).catch(console.error);
					}}
					selectedIndex={input.active === "topics" ? 1 : 0}
					variant="underline"
				>
					<TabsSubtleItem index={0} label="Members" labelClassName="text-sm" />
					<TabsSubtleItem index={1} label="Topics" labelClassName="text-sm" />
				</TabsSubtle>
			}
			renderFrame={false}
			title="Team"
		/>
	);
}
