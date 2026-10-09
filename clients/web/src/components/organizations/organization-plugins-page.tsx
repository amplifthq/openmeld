"use client";

import {
	findPluginDefinition,
	type PluginDefinition,
	pluginFromProvider,
} from "@openmeld/product-catalog/plugins";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { organizationPluginProviderCatalogQueryOptions } from "#/query/organizations/plugin-connections";
import {
	OrganizationPluginDetailPage,
	OrganizationPluginNotFoundPage,
} from "./organization-plugin-detail-page";
import { PluginConnectionRequestPanel } from "./plugin-connection-request-panel";
import { PluginsCatalogPanel } from "./plugins-catalog-panel";

export function OrganizationPluginsPage({
	selectedService,
	connectionRequestId,
}: {
	selectedService: string | null;
	connectionRequestId?: string;
}) {
	const { currentOrganization } = useAppOrganization();
	const catalog = useQuery(
		organizationPluginProviderCatalogQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const provider = catalog.data?.providers.find(
		(item) => item.service === selectedService
	);
	const selectedPlugin = provider
		? pluginFromProvider(provider)
		: findPluginDefinition(selectedService ?? "");
	if (selectedService && catalog.isPending) {
		return <output>Loading Plugin…</output>;
	}
	if (selectedService && catalog.isError) {
		return (
			<p role="alert">
				Unable to load this Plugin. Reload the page to try again.
			</p>
		);
	}

	if (selectedService && !selectedPlugin) {
		return (
			<OrganizationPluginNotFoundPage
				organizationSlug={currentOrganization.slug}
			/>
		);
	}

	if (selectedService && connectionRequestId) {
		return (
			<PluginConnectionRequestPanel
				requestId={connectionRequestId}
				service={selectedService}
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
				description="Plugins let you choose what your Agent can access and do for you."
				eyebrow={
					currentOrganization.isPersonal === true
						? "Personal workspace"
						: currentOrganization.name
				}
				title="Plugins"
			/>
			<PluginsCatalogPanel
				isPersonalWorkspace={currentOrganization.isPersonal === true}
				organizationId={currentOrganization.id}
				organizationName={currentOrganization.name}
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
