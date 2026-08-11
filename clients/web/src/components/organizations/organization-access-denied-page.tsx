import { buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Link } from "@tanstack/react-router";
import { CrossPageHeader } from "#/components/app/cross-page-header";
import { buildOrganizationDefaultPath } from "#/lib/organizations/organization-routes";
import type { OrganizationScopeDenied } from "#/lib/organizations/organization-types";

export function OrganizationAccessDeniedPage(input: {
	scope: OrganizationScopeDenied;
}) {
	const activeOrganization = input.scope.activeOrganization;

	return (
		<main className="min-h-screen bg-background text-foreground">
			<CrossPageHeader showNavigation={false} />
			<div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-xl items-center px-4 py-10 sm:px-6">
				<Card className="w-full">
					<CardHeader>
						<CardTitle>Organization access unavailable</CardTitle>
						<CardDescription>
							This organization is not available from your OpenMeld account.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<p className="text-muted-foreground text-sm">
							Check that you are signed in with the right email address, or ask
							an organization owner to invite you.
						</p>
						<div className="flex flex-col gap-2 sm:flex-row">
							{activeOrganization ? (
								<Link
									className={buttonVariants()}
									to={buildOrganizationDefaultPath(activeOrganization.slug)}
								>
									Go to {activeOrganization.name}
								</Link>
							) : (
								<Link className={buttonVariants()} to="/login">
									Go to OpenMeld
								</Link>
							)}
							<Link
								className={buttonVariants({ variant: "outline" })}
								to="/logout"
							>
								Sign out
							</Link>
						</div>
					</CardContent>
				</Card>
			</div>
		</main>
	);
}
