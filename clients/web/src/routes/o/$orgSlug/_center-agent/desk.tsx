import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { DeskPage } from "#/components/desk/desk-page";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/desk")({
	staticData: appShellStaticData.home,
	component: DeskPage,
});
