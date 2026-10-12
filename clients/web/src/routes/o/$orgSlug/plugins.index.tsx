import { createFileRoute } from "@tanstack/react-router";
import { OrganizationPluginsPage } from "#/components/organizations/organization-plugins-page";
export const Route = createFileRoute("/o/$orgSlug/plugins/")({
	component: () => <OrganizationPluginsPage selectedService={null} />,
});
