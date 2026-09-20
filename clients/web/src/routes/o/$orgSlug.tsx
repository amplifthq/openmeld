import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppShell } from "#/components/app/app-shell";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationAccessDeniedPage } from "#/components/organizations/organization-access-denied-page";
import { organizationScopeQueryOptions } from "#/query/organizations/organization-scope";

const SETTINGS_SECTION_PATTERN = /^[a-z-]{1,40}$/;
export const Route = createFileRoute("/o/$orgSlug")({
	validateSearch: (
		search: Record<string, unknown>
	): { appSettings?: string } => ({
		appSettings:
			typeof search.appSettings === "string" &&
			SETTINGS_SECTION_PATTERN.test(search.appSettings)
				? search.appSettings
				: undefined,
	}),
	ssr: "data-only",
	staticData: appShellStaticData.start,
	staleTime: 0,
	preloadStaleTime: 0,
	loader: async ({ context, location, params }) => {
		const scope = await context.queryClient.fetchQuery(
			organizationScopeQueryOptions({
				organizationSlug: params.orgSlug,
				routeFamily: location.pathname,
			})
		);
		if (scope.access === "authorized") {
			await context.queryPersistence.activateAuthorizedScope({
				organizationId: scope.currentOrganization.id,
				organizationSlug: scope.currentOrganization.slug,
				ownerAccountId: scope.storageScope,
				queryClient: context.queryClient,
			});
		} else if (scope.access === "denied") {
			try {
				await context.queryPersistence.clearOrganizationBySlug(
					scope.storageScope,
					params.orgSlug
				);
			} catch (error) {
				// IndexedDB is only an acceleration layer. Preserve the denied route
				// while keeping the failed cleanup visible to diagnostics.
				console.error(
					"Failed to clear inaccessible organization browser data.",
					error
				);
			}
		}
		return scope;
	},
	component: AppLayoutRoute,
});

function AppLayoutRoute() {
	const scope = Route.useLoaderData();
	const { orgSlug } = Route.useParams();
	const { queryClient, queryPersistence } = Route.useRouteContext();

	useEffect(() => {
		if (scope.access === "denied") {
			queryPersistence
				.clearOrganizationBySlug(scope.storageScope, orgSlug)
				.catch((error: unknown) => {
					console.error(
						"Failed to clear inaccessible organization browser data.",
						error
					);
				});
			return;
		}
		queryPersistence
			.activateAuthorizedScope({
				organizationId: scope.currentOrganization.id,
				organizationSlug: scope.currentOrganization.slug,
				ownerAccountId: scope.storageScope,
				queryClient,
			})
			.catch((error: unknown) => {
				console.error(
					"Failed to activate the authorized browser query cache.",
					error
				);
			});
	}, [orgSlug, queryClient, queryPersistence, scope]);

	if (scope.access === "denied") {
		return <OrganizationAccessDeniedPage scope={scope} />;
	}

	return (
		<AppShell
			account={scope.account}
			organizationScope={scope}
			storageScope={scope.storageScope}
		/>
	);
}
