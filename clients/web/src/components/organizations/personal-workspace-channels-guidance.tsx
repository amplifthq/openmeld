import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { SLACK_INSTALL_INTENT } from "#/lib/organizations/organization-entry-intent";
import { PersonalWorkspaceOrganizationGuidance } from "./personal-workspace-organization-guidance";

export function PersonalWorkspaceChannelsGuidance(input: {
	hasExistingSlackConnection: boolean;
}) {
	return (
		<Card className={surfaceClasses(2)}>
			<CardHeader>
				<CardTitle>
					<h2>Connect Channels in an organization</h2>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<PersonalWorkspaceOrganizationGuidance
					description={
						input.hasExistingSlackConnection
							? "Slack is connected to this Personal Workspace from an earlier setup. Create or choose an organization, then connect the same Slack workspace there to move it."
							: "Connect Slack, Lark, or Feishu in an organization. Teammates can then message its Center Agent and receive replies in the same conversation."
					}
					intent={SLACK_INSTALL_INTENT}
				/>
			</CardContent>
		</Card>
	);
}
