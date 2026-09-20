import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { Link } from "@tanstack/react-router";
import { SLACK_INSTALL_INTENT } from "#/lib/organizations/organization-entry-intent";

export function PersonalWorkspaceChannelsGuidance(input: {
	createOrganizationPath: string;
	hasExistingSlackConnection: boolean;
}) {
	return (
		<Card className={surfaceClasses(2)}>
			<CardHeader>
				<CardTitle>
					<h2>Create an organization to connect Channels</h2>
				</CardTitle>
				<CardDescription>
					{input.hasExistingSlackConnection
						? "Slack is connected to this Personal Workspace from an earlier setup. Create an organization, then connect the same Slack workspace there to move it."
						: "Create an organization before connecting Slack, Lark, or Feishu. Then teammates can message that organization’s Center Agent and receive replies in the same conversation."}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Link
					className={buttonVariants()}
					search={{ intent: SLACK_INSTALL_INTENT }}
					to={input.createOrganizationPath}
				>
					Create organization
				</Link>
			</CardContent>
		</Card>
	);
}
