import type { PluginDefinition } from "@openmeld/product-catalog/plugins";
import { connectorConnectionScopeAllowed } from "@openmeld/schemas";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { buttonVariants } from "@openmeld/ui/components/button";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { buildOrganizationPluginsPath } from "#/lib/organizations/organization-routes";
import { PluginConnectionSurface } from "./plugin-connection-surface";
import { PluginScopeTabs, usePluginScope } from "./plugin-scope-tabs";

export function OrganizationPluginDetailPage(input: {
	plugin: PluginDefinition;
	canManageSharedPlugins: boolean;
	isPersonalWorkspace: boolean;
	organizationId: string;
	organizationSlug: string;
	organizationName: string;
	permissionNotice?: ReactNode;
	catalogPending?: boolean;
}) {
	const selectedScope = usePluginScope();
	const scope =
		input.isPersonalWorkspace || selectedScope === "personal"
			? "member"
			: "shared";
	const scopeAllowed = connectorConnectionScopeAllowed(
		input.plugin.service,
		scope
	);
	const renderDetail = (action: ReactNode, content: ReactNode) => (
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
							</div>
							<p className="mt-1 text-muted-foreground text-xs">
								{input.plugin.category}
							</p>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<a
							className={cn(buttonVariants({ size: "sm", variant: "outline" }))}
							href={input.plugin.homepage}
							rel="noreferrer"
							target="_blank"
						>
							Website
							<ArrowSquareOutIcon aria-hidden="true" data-icon="inline-end" />
						</a>
						{action}
					</div>
				</div>
				<p className="mt-4 max-w-2xl text-muted-foreground text-sm leading-6">
					{input.plugin.description}
				</p>
			</section>
			<PluginScopeTabs
				isPersonalWorkspace={input.isPersonalWorkspace}
				organizationName={input.organizationName}
			/>
			{input.permissionNotice}
			{scopeAllowed ? null : (
				<p className="py-3 text-muted-foreground text-sm">
					{input.plugin.name} is personal-only. Select Personal to connect your
					account.
				</p>
			)}

			<section data-testid="plugin-detail-access">{content}</section>
		</>
	);
	if (input.catalogPending) {
		return renderDetail(
			null,
			<SkeletonForm className="max-w-xl py-4" label="Loading Plugin settings" />
		);
	}
	if (input.plugin.availability !== "available") {
		return renderDetail(
			null,
			<p className="text-muted-foreground text-sm">
				{input.plugin.name} does not have a configured sign-in method yet.
			</p>
		);
	}
	return (
		<PluginConnectionSurface
			canManage={input.canManageSharedPlugins}
			isPersonalWorkspace={input.isPersonalWorkspace}
			key={`${input.organizationId}:${input.plugin.service}:${scope}`}
			mode={scope}
			organizationId={input.organizationId}
			organizationName={input.organizationName}
			plugin={input.plugin}
			renderDetail={renderDetail}
		/>
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
