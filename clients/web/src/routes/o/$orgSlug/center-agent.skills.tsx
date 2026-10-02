import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

// Compatibility only, deliberately outside the Center Agent layout/loaders.
// Redirect at the leaves so the parent cannot consume a detail's identity.
export const Route = createFileRoute("/o/$orgSlug/center-agent/skills")({
	staticData: appShellStaticData.skills,
	component: Outlet,
});
