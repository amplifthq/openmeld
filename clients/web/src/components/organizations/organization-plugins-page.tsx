"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { CenterAgentPluginsCatalogPanel } from "./center-agent-plugins-catalog-panel";
import { useCenterAgentRouteState } from "./center-agent-route-state";
import {
	OrganizationPluginDetailPage,
	OrganizationPluginNotFoundPage,
} from "./organization-plugin-detail-page";
import { findPluginDefinition, type PluginDefinition } from "./plugin-catalog";

export function OrganizationPluginsPage() {
	const { currentOrganization } = useAppOrganization();
	const { pluginsSelectedService } = useCenterAgentRouteState();
	const selectedPlugin = pluginsSelectedService
		? findPluginDefinition(pluginsSelectedService)
		: null;

	if (pluginsSelectedService && !selectedPlugin) {
		return (
			<OrganizationPluginNotFoundPage
				organizationSlug={currentOrganization.slug}
			/>
		);
	}

	if (selectedPlugin?.connection) {
		return (
			<AvailableOrganizationPluginPage
				organization={currentOrganization}
				plugin={selectedPlugin}
			/>
		);
	}

	if (selectedPlugin) {
		return (
			<OrganizationPluginDetailPage
				canManageSharedPlugins={false}
				connectionMode="all"
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				organizationId={currentOrganization.id}
				organizationSlug={currentOrganization.slug}
				plugin={selectedPlugin}
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
				title="Plugins"
			/>
			<CenterAgentPluginsCatalogPanel
				organizationId={currentOrganization.id}
				organizationSlug={currentOrganization.slug}
			/>
		</>
	);
}

function AvailableOrganizationPluginPage(input: {
	plugin: PluginDefinition;
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
	const canManageSharedPlugins =
		input.organization.isPersonal === true ||
		canManageOrganizationArea(roleQuery.data, {
			connector: ["manage"],
		});
	let permissionNotice: ReactNode = null;
	if (input.organization.isPersonal !== true && roleQuery.isPending) {
		permissionNotice = (
			<output className="sr-only">Loading plugin access.</output>
		);
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
		<OrganizationPluginDetailPage
			canManageSharedPlugins={canManageSharedPlugins}
			connectionMode="all"
			isPersonalWorkspace={input.organization.isPersonal === true}
			organizationId={input.organization.id}
			organizationSlug={input.organization.slug}
			permissionNotice={permissionNotice}
			plugin={input.plugin}
		/>
	);
}
