import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationEntryPage } from "#/components/organizations/organization-entry-page";
import {
	type OrganizationEntrySearch,
	resolveOrganizationEntrySearch,
} from "#/lib/organizations/organization-entry-intent";

export const Route = createFileRoute("/o/$orgSlug/organizations")({
	staticData: appShellStaticData.organizations,
	validateSearch: (search): OrganizationEntrySearch =>
		resolveOrganizationEntrySearch(search),
	component: OrganizationsRoute,
});

function OrganizationsRoute() {
	const { intent } = Route.useSearch();
	return <OrganizationEntryPage intent={intent} />;
}
