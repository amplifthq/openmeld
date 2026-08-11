import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "#/components/landing-page/landing-page";
import { resolveOptionalActiveOrganizationEntryPath } from "#/lib/organizations/organization-scope";
import { buildPublicPageHead } from "#/lib/site";

export const Route = createFileRoute("/")({
	head: () => buildPublicPageHead(),
	loader: loadLandingPage,
	component: HomePage,
});

export async function loadLandingPage() {
	const authenticatedEntryPath =
		await resolveOptionalActiveOrganizationEntryPath({
			data: {
				routeFamily: "/",
			},
		});
	return { authenticatedEntryPath };
}

function HomePage() {
	const { authenticatedEntryPath } = Route.useLoaderData();

	return <LandingPage authenticatedEntryPath={authenticatedEntryPath} />;
}
