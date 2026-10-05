import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthPageShell } from "#/components/auth/auth-page-shell";

export const Route = createFileRoute("/account-deleted")({
	component: AccountDeleted,
});
function AccountDeleted() {
	return (
		<AuthPageShell>
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Account closed</CardTitle>
					<CardDescription>You are signed out on all devices.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<p className="text-muted-foreground text-sm">
						Your private data is being deleted. Shared work in your teams stays
						available to other members.
					</p>
					<Link className={buttonVariants({ variant: "outline" })} to="/login">
						Back to sign in
					</Link>
				</CardContent>
			</Card>
		</AuthPageShell>
	);
}
