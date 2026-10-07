import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	createFileRoute,
	type ErrorComponentProps,
	Outlet,
	useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import {
	getAppSidebarStatesForRoute,
	type SidebarPersistedState,
} from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/skills")({
	// No Center Agent session selectors or personal/organization scope selector
	// belong to this catalog. Detail routes own their content tab query.
	validateSearch: () => ({}),
	staticData: appShellStaticData.skills,
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingComponent: SkillsPending,
	errorComponent: SkillsError,
	component: SkillsRoute,
});

function SkillsLayout(input: {
	children: ReactNode;
	initialOuterSidebarState?: SidebarPersistedState;
}) {
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={input.initialOuterSidebarState}
			mainHeader={<TeamHeader active="skills" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			showMainHeader
		>
			<div className="flex w-full flex-col gap-6 px-[var(--app-page-inline-padding)] py-8">
				{input.children}
			</div>
		</AppFullWidthLayout>
	);
}

function SkillsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	return (
		<SkillsLayout initialOuterSidebarState={sidebarStates.outer}>
			<Outlet />
		</SkillsLayout>
	);
}

function SkillsPending() {
	return (
		<SkillsLayout>
			<output aria-label="Loading Skills" className="grid gap-5">
				<Skeleton className="h-12 w-48" />
				<Skeleton className="h-48 w-full" />
			</output>
		</SkillsLayout>
	);
}

function SkillsError({ reset }: ErrorComponentProps) {
	const router = useRouter();
	return (
		<SkillsLayout>
			<div
				className="grid justify-items-start gap-3 rounded-md border p-6"
				role="alert"
			>
				<h1 className="font-medium text-xl">Could not open Skills</h1>
				<p className="text-muted-foreground text-sm">
					Try loading this workspace's Skills again.
				</p>
				<Button
					onClick={() => router.invalidate().then(reset).catch(console.error)}
					variant="outline"
				>
					Retry
				</Button>
			</div>
		</SkillsLayout>
	);
}
