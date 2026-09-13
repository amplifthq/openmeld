import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
export const Route = createFileRoute("/o/$orgSlug/plugins/")({
	// Connection status loads in the catalog; it must not gate navigation.
	component: () => <OrganizationPluginsPage selectedService={null} />,
});
