"use client";

import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { buildOrganizationPluginPath } from "#/lib/organizations/organization-routes";
import {
	organizationPluginConnectionCatalogQueryOptions,
	organizationPluginConnectionStatusSummaryQueryOptions,
} from "#/query/organizations/plugin-connections";
import { AppLogo } from "./app-logo";
import {
	PLUGIN_CATEGORIES,
	PLUGINS,
	type PluginCategory,
	type PluginDefinition,
} from "./plugin-catalog";

export function PluginsCatalogPanel(input: {
	organizationId: string;
	organizationSlug: string;
}) {
	const [activeCategory, setActiveCategory] = useState<PluginCategory>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const queryClient = useQueryClient();
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
	const connectionsQuery = useQuery(
		organizationPluginConnectionCatalogQueryOptions({
			organizationId: input.organizationId,
			queryClient,
		})
	);
	const statusSummaryQuery = useQuery(
		organizationPluginConnectionStatusSummaryQueryOptions({
			organizationId: input.organizationId,
		})
	);
	const connectedServices = new Set<string>();
	if (connectionsQuery.data) {
		for (const connection of connectionsQuery.data.connections) {
			if (connection.status === "active") {
				connectedServices.add(connection.service);
			}
		}
	} else {
		for (const service of statusSummaryQuery.data?.connectedServices ?? []) {
			connectedServices.add(service);
		}
	}
	const connectionStatusIsPending =
		connectionsQuery.isPending && !statusSummaryQuery.data;
	const visiblePlugins = PLUGINS.filter((plugin) => {
		const matchesCategory =
			activeCategory === "All" || plugin.category === activeCategory;
		const matchesSearch =
			normalizedSearchQuery.length === 0 ||
			`${plugin.name} ${plugin.description} ${plugin.category}`
				.toLocaleLowerCase()
				.includes(normalizedSearchQuery);
		return matchesCategory && matchesSearch;
	});

	return (
		<section
			aria-busy={connectionStatusIsPending}
			aria-label="Plugin catalog"
			className="space-y-4"
		>
			<fieldset
				aria-label="Browse Plugins"
				className="flex min-w-0 flex-col gap-3 border-0 p-0 lg:flex-row lg:items-center lg:justify-between"
			>
				<legend className="sr-only">Browse Plugins</legend>
				<div className="flex flex-wrap gap-2">
					{PLUGIN_CATEGORIES.map((category) => (
						<Button
							aria-pressed={activeCategory === category}
							key={category}
							onClick={() => setActiveCategory(category)}
							size="xs"
							type="button"
							variant={activeCategory === category ? "secondary" : "outline"}
						>
							{category}
						</Button>
					))}
				</div>
				<div className="flex w-full items-center justify-between gap-3 lg:w-auto">
					<p
						aria-live="polite"
						className="shrink-0 text-muted-foreground text-xs"
					>
						{visiblePlugins.length}{" "}
						{visiblePlugins.length === 1 ? "Plugin" : "Plugins"}
					</p>
					<div className="relative min-w-0 flex-1 sm:max-w-72 lg:w-72 lg:flex-none">
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
			</fieldset>

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

			{visiblePlugins.length > 0 ? (
				<FluidCardGroup
					className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
					role="list"
				>
					{visiblePlugins.map((plugin) => (
						<FluidCardItem
							className={surfaceClasses(2)}
							itemId={plugin.service}
							key={plugin.service}
							role="listitem"
						>
							<PluginCatalogCard
								connected={connectedServices.has(plugin.service)}
								connectionStatusIsPending={connectionStatusIsPending}
								organizationSlug={input.organizationSlug}
								plugin={plugin}
							/>
						</FluidCardItem>
					))}
				</FluidCardGroup>
			) : (
				<div className="px-5 py-12 text-center">
					<p className="font-medium text-foreground text-sm">
						No Plugins found
					</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Try another search or category.
					</p>
				</div>
			)}
		</section>
	);
}

function PluginCatalogCard(input: {
	plugin: PluginDefinition;
	connected: boolean;
	connectionStatusIsPending: boolean;
	organizationSlug: string;
}) {
	return (
		<div className="h-full overflow-hidden rounded-md">
			<Link
				aria-disabled={input.connectionStatusIsPending || undefined}
				className={cn(
					"group flex h-full min-h-20 min-w-0 items-center gap-3 px-4 py-3 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset sm:px-5",
					input.connectionStatusIsPending &&
						"pointer-events-none cursor-wait opacity-60"
				)}
				onClick={(event) => {
					if (input.connectionStatusIsPending) {
						event.preventDefault();
					}
				}}
				tabIndex={input.connectionStatusIsPending ? -1 : undefined}
				to={buildOrganizationPluginPath({
					orgSlug: input.organizationSlug,
					service: input.plugin.service,
				})}
			>
				<AppLogo app={input.plugin} surfaceLevel={3} />
				<div className="min-w-0 flex-1">
					<h3 className="truncate font-medium text-foreground text-sm">
						{input.plugin.name}
					</h3>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{input.plugin.category}
					</p>
				</div>
				<span
					className="flex w-auto shrink-0 justify-end sm:w-20"
					data-slot="plugin-catalog-card-status"
				>
					<PluginStatusBadge
						connected={input.connected}
						loading={input.connectionStatusIsPending}
						plugin={input.plugin}
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
}

export function PluginStatusBadge(input: {
	plugin: PluginDefinition;
	connected?: boolean;
	loading?: boolean;
}) {
	if (input.plugin.availability === "planned") {
		return (
			<Badge className="border-border bg-muted/40 text-muted-foreground">
				Planned
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
	if (!input.connected) {
		return null;
	}
	return (
		<Badge className={resolveStatusToneProminentBadgeClassName("ready")}>
			Connected
		</Badge>
	);
}
