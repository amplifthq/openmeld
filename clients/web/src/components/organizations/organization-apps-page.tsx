"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { type AppDefinition, findAppDefinition } from "./app-catalog";
import { CenterAgentAppsCatalogPanel } from "./center-agent-apps-catalog-panel";
import { useCenterAgentRouteState } from "./center-agent-route-state";
import {
	OrganizationAppDetailPage,
	OrganizationAppNotFoundPage,
} from "./organization-app-detail-page";

export function OrganizationAppsPage() {
	const { currentOrganization } = useAppOrganization();
	const { appsSelectedService } = useCenterAgentRouteState();
	const selectedApp = appsSelectedService
		? findAppDefinition(appsSelectedService)
		: null;

	if (appsSelectedService && !selectedApp) {
		return (
			<OrganizationAppNotFoundPage
				organizationSlug={currentOrganization.slug}
			/>
		);
	}

	if (selectedApp?.connection) {
		return (
			<AvailableOrganizationAppPage
				app={selectedApp}
				organization={currentOrganization}
			/>
		);
	}

	if (selectedApp) {
		return (
			<OrganizationAppDetailPage
				app={selectedApp}
				canManageSharedApps={false}
				connectionMode="all"
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				organizationId={currentOrganization.id}
				organizationSlug={currentOrganization.slug}
			/>
		);
	}

	return (
		<>
			<AppPageHeader
				description={
					currentOrganization.isPersonal === true
						? "Connect your accounts so your Center Agent can use them. Every action shows which account it uses."
						: `Connect your own accounts or review the accounts shared with ${currentOrganization.name}. Every action shows which account it uses.`
				}
				eyebrow={
					currentOrganization.isPersonal === true
						? "Personal workspace"
						: "Organization"
				}
				title="Apps"
			/>
			<CenterAgentAppsCatalogPanel
				organizationId={currentOrganization.id}
				organizationSlug={currentOrganization.slug}
			/>
		</>
	);
}

function AvailableOrganizationAppPage(input: {
	app: AppDefinition;
	organization: OrganizationSummary;
}) {
	const { currentUserId } = useAppOrganization();
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: input.organization.isPersonal !== true,
			organizationId: input.organization.id,
			userId: currentUserId,
		})
	);
	const canManageSharedApps =
		input.organization.isPersonal === true ||
		canManageOrganizationArea(roleQuery.data, {
			connector: ["manage"],
		});
	let permissionNotice: ReactNode = null;
	if (input.organization.isPersonal !== true && roleQuery.isPending) {
		permissionNotice = <output className="sr-only">Loading app access.</output>;
	} else if (input.organization.isPersonal !== true && roleQuery.isError) {
		permissionNotice = (
			<p
				className="rounded-md border border-destructive bg-destructive/10 px-4 py-3 text-destructive text-sm"
				role="alert"
			>
				OpenMeld could not confirm whether you can manage organization apps.
			</p>
		);
	}

	return (
		<OrganizationAppDetailPage
			app={input.app}
			canManageSharedApps={canManageSharedApps}
			connectionMode="all"
			isPersonalWorkspace={input.organization.isPersonal === true}
			organizationId={input.organization.id}
			organizationSlug={input.organization.slug}
			permissionNotice={permissionNotice}
		/>
	);
}
