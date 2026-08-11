import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { NewOrganizationPage } from "#/components/organizations/organization-entry-page";
import {
	type OrganizationEntrySearch,
	resolveOrganizationEntrySearch,
} from "#/lib/organizations/organization-entry-intent";

export const Route = createFileRoute("/o/$orgSlug/new-organization")({
	staticData: appShellStaticData.organizations,
	validateSearch: (search): OrganizationEntrySearch =>
		resolveOrganizationEntrySearch(search),
	component: NewOrganizationRoute,
});

function NewOrganizationRoute() {
	const { intent } = Route.useSearch();
	return <NewOrganizationPage intent={intent} />;
}
