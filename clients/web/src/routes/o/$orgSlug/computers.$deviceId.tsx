import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute("/o/$orgSlug/computers/$deviceId")({
	staticData: appShellStaticData.computers,
});
