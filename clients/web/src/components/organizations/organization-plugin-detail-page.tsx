import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { buildOrganizationPluginsPath } from "#/lib/organizations/organization-routes";
import { AppLogo } from "./app-logo";
import { CenterAgentGitHubConnectionCard } from "./center-agent-github-connection-card";
import { PluginAgentAccess } from "./plugin-agent-access";
import type { PluginDefinition } from "./plugin-catalog";
import { PluginConnectionCard } from "./plugin-connection-card";
import { PluginScopeTabs, usePluginScope } from "./plugin-scope-tabs";
import { PluginStatusBadge } from "./plugins-catalog-panel";

export function OrganizationPluginDetailPage(input: {
	plugin: PluginDefinition;
	canManageSharedPlugins: boolean;
	isPersonalWorkspace: boolean;
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	permissionNotice?: ReactNode;
}) {
	const selectedScope = usePluginScope();
	const scope =
		input.isPersonalWorkspace || selectedScope === "personal"
			? "member"
			: "shared";
	return (
		<>
			<Link
				className="inline-flex min-h-5 w-fit items-center gap-2 font-medium text-foreground text-sm leading-5 outline-none transition-colors hover:text-foreground/80 focus-visible:ring-1 focus-visible:ring-ring"
				search={{ scope: selectedScope }}
				to={buildOrganizationPluginsPath(input.organizationSlug)}
			>
				<ArrowLeftIcon
					aria-hidden="true"
					className="size-4 shrink-0"
					data-icon="inline-start"
				/>
				All Plugins
			</Link>

			<section className="py-2" data-testid="plugin-detail-summary">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
					<div className="flex min-w-0 items-start gap-3">
						<AppLogo app={input.plugin} size="lg" />
						<div className="min-w-0 pt-0.5">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="font-medium text-2xl text-foreground">
									{input.plugin.name}
								</h1>
								<PluginStatusBadge plugin={input.plugin} />
							</div>
							<p className="mt-1 text-muted-foreground text-xs">
								{input.plugin.category}
							</p>
						</div>
					</div>
					<a
						className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
						href={input.plugin.homepage}
						rel="noreferrer"
						target="_blank"
					>
						Website
						<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-end" />
					</a>
				</div>
			</section>
			<PluginScopeTabs
				isPersonalWorkspace={input.isPersonalWorkspace}
				organizationName={input.organizationName}
			/>
			{input.permissionNotice}

			{input.plugin.availability === "available" ? (
				<section className="overflow-hidden" data-testid="plugin-detail-access">
					<div className="border-border/70 border-b pb-4">
						<h2 className="font-medium text-foreground text-sm">
							{scope === "member" ? "Your account" : input.organizationName}
						</h2>
						<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
							{scope === "member"
								? "Connect your account for your own requests."
								: `Shared with everyone in ${input.organizationName}.`}
						</p>
						{scope === "shared" && !input.canManageSharedPlugins ? (
							<p className="mt-1 text-muted-foreground text-xs">
								Only owners and admins can change these settings.
							</p>
						) : null}
					</div>
					{input.plugin.service === "github" ? (
						<CenterAgentGitHubConnectionCard
							canManage={input.canManageSharedPlugins}
							isPersonalWorkspace={input.isPersonalWorkspace}
							key={`${input.organizationId}:github`}
							mode={scope}
							organizationId={input.organizationId}
							organizationName={input.organizationName}
						/>
					) : (
						<PluginConnectionCard
							canManage={input.canManageSharedPlugins}
							isPersonalWorkspace={input.isPersonalWorkspace}
							key={`${input.organizationId}:${input.plugin.service}`}
							mode={scope}
							organizationId={input.organizationId}
							organizationName={input.organizationName}
							plugin={input.plugin}
						/>
					)}
					<PluginAgentAccess
						organizationId={input.organizationId}
						organizationName={input.organizationName}
						scope={scope}
						service={input.plugin.service}
					/>
				</section>
			) : (
				<section className="rounded-md border border-border/70 bg-card px-4 py-5 sm:px-5">
					<h2 className="font-medium text-foreground text-sm">Availability</h2>
					<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
						{input.plugin.name} is planned and cannot be connected yet.
					</p>
				</section>
			)}
		</>
	);
}

export function OrganizationPluginNotFoundPage(input: {
	organizationSlug: string;
}) {
	return (
		<>
			<section className="flex flex-col gap-1">
				<p className="font-medium text-muted-foreground text-xs">
					Organization
				</p>
				<h1 className="font-medium text-2xl text-foreground">
					Plugin not found
				</h1>
				<p className="max-w-2xl text-muted-foreground text-sm leading-6">
					This Plugin is not available in the OpenMeld catalog.
				</p>
			</section>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"w-fit"
				)}
				to={buildOrganizationPluginsPath(input.organizationSlug)}
			>
				All Plugins
			</Link>
		</>
	);
}
