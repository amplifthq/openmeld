"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { CalendarDotsIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AppPageHeader } from "#/components/app/app-page-header";
import { resolveCenterAgentErrorMessage } from "#/lib/organizations/center-agent";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentSettingsPath } from "#/lib/organizations/organization-routes";
import { centerAgentDesignationQueryOptions } from "#/query/organizations/center-agent";
import { CenterAgentRoutinesPanel } from "./center-agent-routines-panel";

export function CenterAgentRoutinesPage() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);

	return (
		<>
			{designationQuery.isSuccess &&
			designationQuery.data.designation !== null ? null : (
				<AppPageHeader
					description="Schedule work in a Space or a connected conversation."
					eyebrow={
						currentOrganization.isPersonal === true
							? "Personal workspace"
							: "Organization"
					}
					title="Routines"
				/>
			)}
			{designationQuery.isPending ? (
				<section aria-busy="true" aria-live="polite">
					<p className="text-muted-foreground text-sm">
						Checking Center Agent connection.
					</p>
				</section>
			) : null}
			{designationQuery.isError ? (
				<section
					aria-labelledby="routines-designation-error-title"
					className="rounded-md border border-destructive/50 bg-destructive/5 p-5"
				>
					<h2
						className="font-medium text-foreground text-sm"
						id="routines-designation-error-title"
					>
						Could not check the Center Agent connection
					</h2>
					<p className="mt-2 break-words text-destructive text-sm" role="alert">
						{resolveCenterAgentErrorMessage(
							designationQuery.error,
							"designation_read"
						)}
					</p>
					<Button
						className="mt-4"
						disabled={designationQuery.isRefetching}
						onClick={() => {
							designationQuery.refetch().catch((error) => {
								console.error(
									"Failed to refresh the Center Agent designation for Routines.",
									error
								);
							});
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</section>
			) : null}
			{designationQuery.isSuccess &&
			designationQuery.data.designation === null ? (
				<section className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-10 text-center">
					<span className="grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground">
						<CalendarDotsIcon aria-hidden="true" className="size-5" />
					</span>
					<h2 className="mt-4 font-medium text-foreground text-lg">
						Connect a Center Agent to run Routines
					</h2>
					<p className="mt-2 max-w-md text-muted-foreground text-sm leading-6">
						Routines are carried out by your Center Agent. Connect one before
						scheduling recurring work.
					</p>
					<Link
						className={`${buttonVariants({ size: "sm" })} mt-5`}
						to={buildOrganizationCenterAgentSettingsPath(
							currentOrganization.slug
						)}
					>
						Connect Center Agent
					</Link>
				</section>
			) : null}
			{designationQuery.isSuccess &&
			designationQuery.data.designation !== null ? (
				<CenterAgentRoutinesPanel
					currentUserId={currentUserId}
					isPersonalWorkspace={currentOrganization.isPersonal === true}
					organizationId={currentOrganization.id}
					orgSlug={currentOrganization.slug}
				/>
			) : null}
		</>
	);
}
