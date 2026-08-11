import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { buildOrganizationAppsPath } from "#/lib/organizations/organization-routes";
import type { AppDefinition } from "./app-catalog";
import { AppLogo } from "./app-logo";
import { CenterAgentAppConnectionCard } from "./center-agent-app-connection-card";
import { AppStatusBadge } from "./center-agent-apps-catalog-panel";
import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";

export function OrganizationAppDetailPage(input: {
	app: AppDefinition;
	canManageSharedApps: boolean;
	connectionMode: "all" | "member";
	isPersonalWorkspace: boolean;
	organizationId: string;
	organizationSlug: string;
	permissionNotice?: ReactNode;
}) {
	return (
		<>
			<Link
				className="inline-flex min-h-5 w-fit items-center gap-2 font-medium text-foreground text-sm leading-5 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-1 focus-visible:ring-ring"
				to={buildOrganizationAppsPath(input.organizationSlug)}
			>
				<ArrowLeftIcon
					aria-hidden="true"
					className="size-4 shrink-0"
					data-icon="inline-start"
				/>
				All Apps
			</Link>

			<section
				className="rounded-md border border-border/70 bg-card px-4 py-4 sm:px-5"
				data-testid="app-detail-summary"
			>
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex min-w-0 items-start gap-3">
						<AppLogo app={input.app} size="lg" />
						<div className="min-w-0 pt-0.5">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="font-medium text-2xl text-foreground">
									{input.app.name}
								</h1>
								<AppStatusBadge app={input.app} />
							</div>
							<p className="mt-1 text-muted-foreground text-xs">
								{input.app.category}
							</p>
						</div>
					</div>
					<a
						className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
						href={input.app.homepage}
						rel="noreferrer"
						target="_blank"
					>
						Website
						<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-end" />
					</a>
				</div>
				<p className="mt-4 max-w-2xl text-muted-foreground text-sm leading-6">
					{input.app.description}
				</p>
			</section>
			{input.permissionNotice}

			{input.app.availability === "available" ? (
				<section
					className="overflow-hidden rounded-md border border-border/70 bg-card"
					data-testid="app-detail-access"
				>
					<div className="border-border/70 border-b px-4 py-4 sm:px-5">
						<h2 className="font-medium text-foreground text-sm">
							{input.app.name} access
						</h2>
						<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
							{input.isPersonalWorkspace
								? "Your connection stays private to your requests. Workspace access is available to your Center Agent and Routines."
								: "Your connection stays private to your requests. Organization access is available to every member and Routine."}
						</p>
					</div>
					{input.app.service === "github" ? (
						<CenterAgentGitHubConnectionCard
							canManage={input.canManageSharedApps}
							isPersonalWorkspace={input.isPersonalWorkspace}
							key={`${input.organizationId}:github`}
							mode={input.connectionMode}
							organizationId={input.organizationId}
						/>
					) : (
						<CenterAgentAppConnectionCard
							app={input.app}
							canManage={input.canManageSharedApps}
							isPersonalWorkspace={input.isPersonalWorkspace}
							key={`${input.organizationId}:${input.app.service}`}
							mode={input.connectionMode}
							organizationId={input.organizationId}
						/>
					)}
				</section>
			) : (
				<section className="rounded-md border border-border/70 bg-card px-4 py-5 sm:px-5">
					<h2 className="font-medium text-foreground text-sm">Availability</h2>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						{input.app.name} is planned and cannot be connected yet.
					</p>
				</section>
			)}
		</>
	);
}

export function OrganizationAppNotFoundPage(input: {
	organizationSlug: string;
}) {
	return (
		<>
			<section className="flex flex-col gap-1">
				<p className="font-medium text-muted-foreground text-xs">
					Organization
				</p>
				<h1 className="font-medium text-2xl text-foreground">App not found</h1>
				<p className="max-w-2xl text-muted-foreground text-sm leading-6">
					This App is not available in the OpenMeld catalog.
				</p>
			</section>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"w-fit"
				)}
				to={buildOrganizationAppsPath(input.organizationSlug)}
			>
				All Apps
			</Link>
		</>
	);
}
