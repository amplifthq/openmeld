import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Link } from "@tanstack/react-router";

export function PersonalWorkspaceInvitationGuidance(input: {
	createOrganizationPath: string;
	title: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{input.title}</CardTitle>
				<CardDescription>
					Personal workspaces are just for you. Create or switch to an
					organization when you want to invite teammates and work together.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Link className={buttonVariants()} to={input.createOrganizationPath}>
					Create organization
				</Link>
			</CardContent>
		</Card>
	);
}
