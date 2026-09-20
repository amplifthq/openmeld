import { Button } from "@openmeld/ui/components/button";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";
import {
	AgentDetailSkeleton,
	AgentListSkeleton,
} from "./agent-profile-skeleton";

/** Identity resolution never removes the already authorized Team shell. */
export function AgentResolutionPage(input: {
	detail: boolean;
	initialSidebarStates?: AppSidebarPersistedStates;
	isPending: boolean;
	error?: boolean;
	message?: string;
	onRetry?: () => void;
	isRetrying?: boolean;
}) {
	const { currentOrganization } = useAppOrganization();
	const placeholder = input.detail ? (
		<AgentDetailSkeleton />
	) : (
		<AgentListSkeleton />
	);
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={input.initialSidebarStates?.outer}
			mainSidebarContent={<TeamPeopleSidebar />}
		>
			<div className="px-[var(--app-page-inline-padding)] pt-5">
				<Link
					className="inline-flex items-center gap-2 text-muted-foreground text-sm hover:text-foreground"
					to={buildOrganizationPeoplePath(currentOrganization.slug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> Back to Team
				</Link>
			</div>
			{input.isPending ? (
				placeholder
			) : (
				<div className="space-y-3 px-[var(--app-page-inline-padding)] py-6">
					<p role={input.error ? "alert" : "status"}>{input.message}</p>
					{input.onRetry ? (
						<Button
							disabled={input.isRetrying}
							onClick={input.onRetry}
							size="sm"
							variant="outline"
						>
							Try again
						</Button>
					) : null}
				</div>
			)}
		</AppFullWidthLayout>
	);
}
