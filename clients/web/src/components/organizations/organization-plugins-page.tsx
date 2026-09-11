"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import {
	OrganizationPluginDetailPage,
	OrganizationPluginNotFoundPage,
} from "./organization-plugin-detail-page";
import { findPluginDefinition, type PluginDefinition } from "./plugin-catalog";
import { PluginScopeTabs } from "./plugin-scope-tabs";
import { PluginsCatalogPanel } from "./plugins-catalog-panel";

export function OrganizationPluginsPage({
	selectedService,
}: {
	selectedService: string | null;
}) {
	const { currentOrganization } = useAppOrganization();
	const selectedPlugin = selectedService
		? findPluginDefinition(selectedService)
		: null;

	if (selectedService && !selectedPlugin) {
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
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				organizationId={currentOrganization.id}
				organizationName={currentOrganization.name}
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
						? "Connect your apps to your Agents."
						: "Connect apps for yourself or your team."
				}
				eyebrow={
					currentOrganization.isPersonal === true
						? "Personal workspace"
						: currentOrganization.name
				}
				title="Plugins"
			/>
			<PluginScopeTabs
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				organizationName={currentOrganization.name}
			/>
			<PluginsCatalogPanel
				isPersonalWorkspace={currentOrganization.isPersonal === true}
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
			isPersonalWorkspace={input.organization.isPersonal === true}
			organizationId={input.organization.id}
			organizationName={input.organization.name}
			organizationSlug={input.organization.slug}
			permissionNotice={permissionNotice}
			plugin={input.plugin}
		/>
	);
}
