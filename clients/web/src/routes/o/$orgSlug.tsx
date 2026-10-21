import { createFileRoute, redirect } from "@tanstack/react-router";
import { AppShell } from "#/components/app/app-shell";
import { AppShellPending } from "#/components/app/app-shell-pending";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationAccessDeniedPage } from "#/components/organizations/organization-access-denied-page";
import {
	resolveOrganizationScopeForContext,
	resolvePublicLoginRedirectTarget,
} from "#/lib/organizations/organization-scope";
import { usageScopeParser } from "#/lib/page-tab-search";
import { resetAccountScopedQueriesAfterAuthChange } from "#/query/auth-boundary";
import { accountOrganizationContextQueryOptions } from "#/query/organizations/account-organization-context";

const SETTINGS_SECTION_PATTERN = /^[a-z-]{1,40}$/;
export const Route = createFileRoute("/o/$orgSlug")({
	validateSearch: (
		search: Record<string, unknown>
	): { appSettings?: string; usageScope?: "organization" | "my" } => ({
		usageScope:
			typeof search.usageScope === "string"
				? (usageScopeParser.parse(search.usageScope) ?? undefined)
				: undefined,
		appSettings:
			typeof search.appSettings === "string" &&
			SETTINGS_SECTION_PATTERN.test(search.appSettings)
				? search.appSettings
				: undefined,
	}),
	ssr: false,
	pendingComponent: AppShellPending,
	staticData: appShellStaticData.start,
	staleTime: 0,
	preloadStaleTime: 0,
	loader: async ({ abortController, context, location, params }) => {
		const accountContext = await context.queryClient.fetchQuery(
			accountOrganizationContextQueryOptions(location.pathname)
		);
		abortController.signal.throwIfAborted();
		if (!accountContext) {
			await resetAccountScopedQueriesAfterAuthChange(context.queryClient, {
				queryPersistence: context.queryPersistence,
			});
			throw redirect({
				to: "/login",
				search: {
					redirect: resolvePublicLoginRedirectTarget(
						location.pathname,
						location.searchStr
					),
				},
			});
		}
		const scope = resolveOrganizationScopeForContext({
			context: accountContext,
			orgSlug: params.orgSlug,
		});
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
		abortController.signal.throwIfAborted();
		return scope;
	},
	component: AppLayoutRoute,
});

function AppLayoutRoute() {
	const scope = Route.useLoaderData();

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
