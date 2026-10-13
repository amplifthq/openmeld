"use client";

import {
	PLUGIN_CATEGORIES,
	PLUGINS,
	type PluginCategory,
	type PluginDefinition,
	pluginsForCatalog,
} from "@openmeld/product-catalog/plugins";
import { connectorConnectionScopeAllowed } from "@openmeld/schemas";
import { AppLogo } from "@openmeld/ui/components/app-logo";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { PageToolbar } from "@openmeld/ui/components/page-toolbar";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { SkeletonRegion } from "@openmeld/ui/components/skeleton-content";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	CaretLeftIcon,
	CaretRightIcon,
	FunnelIcon,
	MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import { buildOrganizationPluginPath } from "#/lib/organizations/organization-routes";
import {
	organizationPluginConnectionCatalogQueryOptions,
	organizationPluginProviderCatalogQueryOptions,
} from "#/query/organizations/plugin-connections";
import { PluginScopeTabs, usePluginScope } from "./plugin-scope-tabs";

export function PluginsCatalogPanel(input: {
	organizationId: string;
	organizationName: string;
	organizationSlug: string;
	isPersonalWorkspace?: boolean;
}) {
	const selectedScope = usePluginScope();
	const scope = input.isPersonalWorkspace ? "personal" : selectedScope;
	const [activeCategory, setActiveCategory] = useState<PluginCategory>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const [connectedOnly, setConnectedOnly] = useState(false);
	const catalogId = useId();
	const queryClient = useQueryClient();
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
	const scopeName = {
		personal: "Personal",
		organization: input.organizationName,
	}[scope];
	const providersQuery = useQuery(
		organizationPluginProviderCatalogQueryOptions({
			organizationId: input.organizationId,
		})
	);
	const connectionsQuery = useQuery(
		organizationPluginConnectionCatalogQueryOptions({
			organizationId: input.organizationId,
			queryClient,
		})
	);
	const servicesByScope = {
		personal: connectionServices(connectionsQuery.data, "personal"),
		organization: connectionServices(connectionsQuery.data, "organization"),
	};
	const { connectedServices } = servicesByScope[scope];
	const connectionStatusIsPending = connectionsQuery.isPending;
	const olderPersonalServices =
		scope === "organization"
			? [
					...new Set(
						connectionsQuery.data?.connections
							.filter(
								(connection) =>
									connection.scope === "shared" &&
									connection.status !== "disconnected" &&
									connection.canDisconnect &&
									!connectorConnectionScopeAllowed(
										connection.service,
										connection.scope
									)
							)
							.map((connection) => connection.service) ?? []
					),
				]
			: [];
	const visiblePlugins = pluginsForCatalog(
		providersQuery.data?.providers ?? [],
		normalizedSearchQuery
			? new Set([
					...connectedServices,
					...servicesByScope.personal.connectedServices,
				])
			: connectedServices
	).filter((plugin) => {
		const matchesScope = catalogResultScope(plugin.service, scope) === scope;
		const matchesCategory =
			activeCategory === "All" || plugin.category === activeCategory;
		const matchesSearch =
			normalizedSearchQuery.length === 0 ||
			`${plugin.name} ${plugin.description} ${plugin.category}`
				.toLocaleLowerCase()
				.includes(normalizedSearchQuery);
		return (
			(matchesScope || normalizedSearchQuery.length > 0) &&
			matchesCategory &&
			matchesSearch &&
			(!connectedOnly ||
				(matchesScope && connectedServices.has(plugin.service)))
		);
	});
	const resultsPending =
		providersQuery.isPending || (connectedOnly && connectionStatusIsPending);
	const sections = PLUGIN_CATEGORIES.filter((category) => category !== "All")
		.map((category) => ({
			category,
			id: `${catalogId}-${category.replaceAll(" ", "-")}`,
			plugins: visiblePlugins.filter((plugin) => plugin.category === category),
		}))
		.filter((section) => section.plugins.length > 0);

	return (
		<section
			aria-busy={providersQuery.isPending || connectionStatusIsPending}
			aria-label="Plugin catalog"
			className="@container space-y-4"
		>
			<PageToolbar
				aria-label="Browse Plugins"
				className="gap-x-6 gap-y-3"
				role="group"
			>
				<PluginScopeTabs
					isPersonalWorkspace={input.isPersonalWorkspace === true}
					organizationName={input.organizationName}
				/>
				<div className="ml-auto flex @lg:w-auto w-full items-center gap-2">
					<TooltipHint content={`Show connected Plugins in ${scopeName}`}>
						<Button
							aria-label="Show connected Plugins"
							aria-pressed={connectedOnly}
							onClick={() => setConnectedOnly(!connectedOnly)}
							size="icon"
							variant={connectedOnly ? "secondary" : "ghost"}
						>
							<FunnelIcon
								aria-hidden="true"
								weight={connectedOnly ? "fill" : "regular"}
							/>
						</Button>
					</TooltipHint>
					<div className="relative @lg:w-64 min-w-0 flex-1">
						<label className="sr-only" htmlFor="plugin-catalog-search">
							Search Plugins
						</label>
						<MagnifyingGlassIcon
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							className="pl-8"
							id="plugin-catalog-search"
							onChange={(event) => setSearchQuery(event.target.value)}
							placeholder="Search Plugins"
							type="search"
							value={searchQuery}
						/>
					</div>
				</div>
			</PageToolbar>

			{activeCategory !== "All" ? (
				<Button
					className="-ml-2"
					onClick={() => setActiveCategory("All")}
					size="sm"
					type="button"
					variant="ghost"
				>
					<CaretLeftIcon aria-hidden="true" className="size-3.5" />
					All Plugins
				</Button>
			) : null}

			{providersQuery.isError ? (
				<div className="flex items-center justify-between gap-2" role="alert">
					<p className="text-destructive text-sm">Unable to load Plugins.</p>
					<Button
						onClick={() => providersQuery.refetch()}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}
			{connectionsQuery.isError ? (
				<div
					className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2"
					role="alert"
				>
					<p className="text-destructive text-xs">
						OpenMeld could not load Plugin connection status.
					</p>
					<Button
						onClick={() => connectionsQuery.refetch()}
						size="xs"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}

			{olderPersonalServices.length > 0 ? (
				<p className="text-muted-foreground text-xs">
					Older personal-only connections are disabled.{" "}
					{olderPersonalServices.map((service) => (
						<Link
							className="mr-3 underline underline-offset-4"
							key={service}
							search={{ scope: "organization" }}
							to={buildOrganizationPluginPath({
								orgSlug: input.organizationSlug,
								service,
							})}
						>
							Review{" "}
							{PLUGINS.find((plugin) => plugin.service === service)?.name ??
								service}
						</Link>
					))}
				</p>
			) : null}
			{visiblePlugins.length > 0 ? (
				<FluidCardGroup className="space-y-6">
					{sections.map(({ category, id, plugins }) => (
						<section aria-labelledby={id} className="space-y-2" key={category}>
							<h2 className="font-medium text-foreground text-sm" id={id}>
								{activeCategory === "All" ? (
									<Button
										aria-label={`View all ${category} Plugins`}
										className="-ml-2 font-medium"
										onClick={() => setActiveCategory(category)}
										size="sm"
										type="button"
										variant="ghost"
									>
										{category}
										<CaretRightIcon aria-hidden="true" className="size-3.5" />
									</Button>
								) : (
									category
								)}
							</h2>
							<ul
								aria-label={`${category} Plugins`}
								className="grid @3xl:grid-cols-2 gap-x-6 gap-y-1"
							>
								{plugins.map((plugin) => {
									const resultScope = catalogResultScope(plugin.service, scope);
									const status = servicesByScope[resultScope];
									return (
										<li className="min-w-0" key={plugin.service}>
											<FluidCardItem
												className="bg-transparent"
												itemId={plugin.service}
											>
												<PluginCatalogCard
													connected={
														connectionsQuery.data
															? status.connectedServices.has(plugin.service)
															: undefined
													}
													connectionStatusIsPending={connectionStatusIsPending}
													organizationSlug={input.organizationSlug}
													personalResult={resultScope !== scope}
													plugin={plugin}
													reconnectRequired={status.reconnectServices.has(
														plugin.service
													)}
													scope={resultScope}
												/>
											</FluidCardItem>
										</li>
									);
								})}
							</ul>
						</section>
					))}
				</FluidCardGroup>
			) : null}
			{resultsPending ? <PluginCatalogSkeleton /> : null}
			{visiblePlugins.length === 0 &&
			!resultsPending &&
			providersQuery.isSuccess &&
			(!connectedOnly || connectionsQuery.isSuccess) ? (
				<PluginCatalogEmptyState
					connectedOnly={connectedOnly}
					onClear={() => {
						setSearchQuery("");
						setActiveCategory("All");
						setConnectedOnly(false);
					}}
					scopeName={scopeName}
				/>
			) : null}
		</section>
	);
}

function PluginCatalogEmptyState(input: {
	connectedOnly: boolean;
	scopeName: string;
	onClear: () => void;
}) {
	return (
		<div className="px-5 py-12 text-center">
			<p className="font-medium text-foreground text-sm">
				{input.connectedOnly
					? `No connected Plugins in ${input.scopeName}`
					: "No Plugins found"}
			</p>
			<p className="mt-1 text-muted-foreground text-xs">
				Try another search or clear your filters.
			</p>
			<Button onClick={input.onClear} size="sm" variant="ghost">
				Clear filters
			</Button>
		</div>
	);
}

function catalogResultScope(
	service: string,
	scope: "personal" | "organization"
) {
	return connectorConnectionScopeAllowed(
		service,
		scope === "personal" ? "member" : "shared"
	)
		? scope
		: "personal";
}

function PluginCatalogSkeleton() {
	return (
		<SkeletonRegion label="Loading Plugins">
			<Skeleton className="my-3 h-4 w-28" />
			<div className="grid @3xl:grid-cols-2 gap-x-6 gap-y-1">
				{["first", "second", "third", "fourth", "fifth", "sixth"].map((id) => (
					<div className="flex min-h-20 items-center gap-3 px-2 py-3" key={id}>
						<Skeleton className="size-10 shrink-0" />
						<div className="min-w-0 flex-1 space-y-2">
							<Skeleton className="h-4 w-32 max-w-full" />
							<Skeleton className="h-3 w-3/4" />
						</div>
					</div>
				))}
			</div>
		</SkeletonRegion>
	);
}

function connectionServices(
	connections:
		| import("@openmeld/schemas/types").ConnectorConnectionListResponse
		| undefined,
	scope: "personal" | "organization"
) {
	const connectedServices = new Set<string>();
	const reconnectServices = new Set<string>();
	if (connections) {
		for (const connection of connections.connections) {
			if (
				connection.status === "active" &&
				(scope === "organization"
					? connection.scope === "shared"
					: connection.scope === "member" &&
						connection.userId === connections.currentUserId)
			) {
				connectedServices.add(connection.service);
				if (connection.health?.state === "reconnect_required") {
					reconnectServices.add(connection.service);
				}
			}
		}
	}
	return { connectedServices, reconnectServices };
}

function PluginCatalogCard(input: {
	reconnectRequired?: boolean;
	plugin: PluginDefinition;
	connected: boolean | undefined;
	connectionStatusIsPending: boolean;
	organizationSlug: string;
	scope: "personal" | "organization";
	personalResult: boolean;
}) {
	const href = `${buildOrganizationPluginPath({ orgSlug: input.organizationSlug, service: input.plugin.service })}?scope=${input.scope}`;
	const card = (
		<div className="h-full overflow-hidden rounded-md">
			<Link
				className="group flex h-full min-h-20 min-w-0 items-center gap-3 px-2 py-3 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
				search={{ scope: input.scope }}
				to={buildOrganizationPluginPath({
					orgSlug: input.organizationSlug,
					service: input.plugin.service,
				})}
			>
				<AppLogo app={input.plugin} surfaceLevel={3} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<h3 className="truncate font-medium text-foreground text-sm">
							{input.plugin.name}
						</h3>
						{input.personalResult ? (
							<Badge className="shrink-0" variant="outline">
								Personal
							</Badge>
						) : null}
					</div>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{input.plugin.description}
					</p>
				</div>
				<span
					className="flex shrink-0 justify-end whitespace-nowrap"
					data-slot="plugin-catalog-card-status"
				>
					<PluginStatusBadge
						connected={input.connected}
						loading={input.connectionStatusIsPending}
						plugin={input.plugin}
						reconnectRequired={input.reconnectRequired}
					/>
				</span>
				<CaretRightIcon
					aria-hidden="true"
					className="hidden size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground sm:block"
					data-slot="plugin-catalog-card-arrow"
				/>
			</Link>
		</div>
	);
	return (
		<FluidContextMenu target={card}>
			<ObjectMenuItems href={href} />
		</FluidContextMenu>
	);
}

export function PluginStatusBadge(input: {
	reconnectRequired?: boolean;
	plugin: PluginDefinition;
	connected?: boolean;
	loading?: boolean;
}) {
	if (input.plugin.availability === "planned") {
		return (
			<Badge className="border-border bg-muted/40 text-muted-foreground">
				Setup unavailable
			</Badge>
		);
	}
	if (input.loading) {
		return (
			<Skeleton
				aria-hidden="true"
				className="h-5 w-16"
				data-testid="plugin-connection-status-skeleton"
			/>
		);
	}
	if (input.reconnectRequired) {
		return <Badge variant="outline">Reconnect required</Badge>;
	}
	if (
		!input.connected &&
		input.plugin.connection.auth.kind === "oauth" &&
		input.plugin.connection.auth.configured === false &&
		!input.plugin.connection.auth.credentialFallback &&
		!input.plugin.connection.credentials?.length
	) {
		return (
			<span className="text-muted-foreground text-xs">Sign-in unavailable</span>
		);
	}
	if (!input.connected) {
		return input.connected === false ? (
			<span className="text-muted-foreground text-xs">Not connected</span>
		) : null;
	}
	return (
		<Badge className={resolveStatusToneProminentBadgeClassName("ready")}>
			Connected
		</Badge>
	);
}
