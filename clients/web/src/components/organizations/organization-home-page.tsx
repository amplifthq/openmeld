"use client";

import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowClockwiseIcon, RobotIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import {
	centerAgentDesignationQueryOptions,
	centerAgentOperatingStateQueryOptions,
} from "#/query/organizations/center-agent";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { resolveDesignatedCenterAgentProfile } from "./center-agent-profile-presentation";
import { OrganizationHomeDirectory } from "./organization-home-directory";
import { OrganizationHomeInbox } from "./organization-home-inbox";
import { OrganizationHomeResources } from "./organization-home-resources";
import { OrganizationHomeWork } from "./organization-home-work";

export function OrganizationHomePage() {
	const { currentOrganization } = useAppOrganization();
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const designationQuery = useQuery(
		centerAgentDesignationQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const operatingStateQuery = useQuery(
		centerAgentOperatingStateQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const identityRefreshFailed =
		directoryQuery.isError || designationQuery.isError;
	const identityInputs =
		!identityRefreshFailed && directoryQuery.data && designationQuery.data
			? {
					agentProfiles: directoryQuery.data.agentProfiles,
					designation: designationQuery.data.designation,
				}
			: null;
	const centerAgent = identityInputs
		? resolveDesignatedCenterAgentProfile(identityInputs)
		: null;
	const identityIsPending =
		(!directoryQuery.data && directoryQuery.isPending) ||
		(!designationQuery.data && designationQuery.isPending);
	const identityIsUnavailable =
		identityRefreshFailed || !(identityIsPending || centerAgent);
	let centerAgentAvatar = (
		<span className="grid size-11 shrink-0 place-items-center rounded-full border border-border/70 bg-muted/40 text-muted-foreground">
			<RobotIcon aria-hidden="true" className="size-5" />
		</span>
	);
	if (identityIsPending) {
		centerAgentAvatar = <Skeleton className="size-11 shrink-0 rounded-full" />;
	} else if (centerAgent) {
		centerAgentAvatar = (
			<DitherProfileAvatar
				profileId={centerAgent.profileId}
				profileKind="center-agent"
				profileName={centerAgent.profileName}
				size={44}
			/>
		);
	}
	let centerAgentSubtitle: ReactNode = null;
	if (centerAgent) {
		centerAgentSubtitle = (
			<p className="truncate text-muted-foreground text-xs">
				@{centerAgent.profileHandle}
			</p>
		);
	} else if (identityIsUnavailable) {
		centerAgentSubtitle = (
			<p className="text-muted-foreground text-xs" role="alert">
				Center Agent is unavailable.
			</p>
		);
	}
	let centerAgentAction: ReactNode;
	if (identityIsUnavailable) {
		centerAgentAction = (
			<Button
				className="w-full sm:ms-auto sm:w-auto"
				onClick={() =>
					Promise.all([directoryQuery.refetch(), designationQuery.refetch()])
				}
				type="button"
				variant="outline"
			>
				<ArrowClockwiseIcon aria-hidden="true" className="size-4" />
				Try again
			</Button>
		);
	} else if (identityIsPending) {
		centerAgentAction = (
			<Button
				className="w-full sm:ms-auto sm:w-auto"
				disabled
				type="button"
				variant="outline"
			>
				Loading Center Agent
			</Button>
		);
	} else {
		centerAgentAction = (
			<Link
				className={buttonVariants({
					className: "w-full sm:ms-auto sm:w-auto",
				})}
				to={buildOrganizationCenterAgentChatPath(currentOrganization.slug)}
			>
				Ask Center Agent
			</Link>
		);
	}

	return (
		<div className="flex flex-col gap-9 pb-8">
			<header>
				<h1 className="font-semibold text-2xl tracking-tight">
					{currentOrganization.name}
				</h1>
			</header>

			<section aria-labelledby="center-agent-home-title">
				<div className="rounded-xl border border-border/70 bg-card p-4 shadow-xs sm:p-5">
					<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
						<div className="flex min-w-0 items-center gap-3">
							{centerAgentAvatar}
							<div className="min-w-0">
								<h2
									className="truncate font-medium text-sm"
									id="center-agent-home-title"
								>
									{centerAgent?.profileName ?? "Center Agent"}
								</h2>
								{centerAgentSubtitle}
							</div>
							{centerAgent &&
							operatingStateQuery.data?.operatingState === "paused" ? (
								<span className="rounded-full bg-amber-500/10 px-2 py-1 font-medium text-amber-700 text-xs dark:text-amber-300">
									Paused
								</span>
							) : null}
						</div>

						{centerAgentAction}
					</div>
					{operatingStateQuery.isError ? (
						<StaleDataNotice
							className="mx-0 mt-3"
							label="Center Agent status is unavailable."
							onRetry={() => operatingStateQuery.refetch()}
						/>
					) : null}
				</div>
			</section>

			<OrganizationHomeInbox currentOrganization={currentOrganization} />
			<OrganizationHomeWork />
			<OrganizationHomeDirectory />
			<OrganizationHomeResources />
		</div>
	);
}
