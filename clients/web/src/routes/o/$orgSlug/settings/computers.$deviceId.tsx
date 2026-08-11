import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute(
	"/o/$orgSlug/settings/computers/$deviceId"
)({
	staticData: appShellStaticData.computers,
});
