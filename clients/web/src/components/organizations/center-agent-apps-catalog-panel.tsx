"use client";

import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent } from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { CaretRightIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { buildOrganizationAppPath } from "#/lib/organizations/organization-routes";
import {
	organizationAppConnectionCatalogQueryOptions,
	organizationAppConnectionStatusSummaryQueryOptions,
} from "#/query/organizations/app-connections";
import {
	APP_CATEGORIES,
	APPS,
	type AppCategory,
	type AppDefinition,
} from "./app-catalog";
import { AppLogo } from "./app-logo";

export function CenterAgentAppsCatalogPanel(input: {
	organizationId: string;
	organizationSlug: string;
}) {
	const [activeCategory, setActiveCategory] = useState<AppCategory>("All");
	const [searchQuery, setSearchQuery] = useState("");
	const queryClient = useQueryClient();
	const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
	const connectionsQuery = useQuery(
		organizationAppConnectionCatalogQueryOptions({
			organizationId: input.organizationId,
			queryClient,
		})
	);
	const statusSummaryQuery = useQuery(
		organizationAppConnectionStatusSummaryQueryOptions({
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
	const visibleApps = APPS.filter((app) => {
		const matchesCategory =
			activeCategory === "All" || app.category === activeCategory;
		const matchesSearch =
			normalizedSearchQuery.length === 0 ||
			`${app.name} ${app.description} ${app.category}`
				.toLocaleLowerCase()
				.includes(normalizedSearchQuery);
		return matchesCategory && matchesSearch;
	});

	return (
		<section
			aria-busy={connectionStatusIsPending}
			aria-label="App catalog"
			className="space-y-4"
		>
			<fieldset
				aria-label="Browse Apps"
				className="flex min-w-0 flex-col gap-3 border-0 p-0 lg:flex-row lg:items-center lg:justify-between"
			>
				<legend className="sr-only">Browse Apps</legend>
				<div className="flex flex-wrap gap-2">
					{APP_CATEGORIES.map((category) => (
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
						{visibleApps.length} {visibleApps.length === 1 ? "App" : "Apps"}
					</p>
					<div className="relative min-w-0 flex-1 sm:max-w-72 lg:w-72 lg:flex-none">
						<label className="sr-only" htmlFor="app-catalog-search">
							Search Apps
						</label>
						<MagnifyingGlassIcon
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							className="pl-8"
							id="app-catalog-search"
							onChange={(event) => setSearchQuery(event.target.value)}
							placeholder="Search Apps"
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
						OpenMeld could not load App connection status.
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

			{visibleApps.length > 0 ? (
				<FluidCardGroup
					className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
					role="list"
				>
					{visibleApps.map((app) => (
						<FluidCardItem
							itemId={app.service}
							key={app.service}
							role="listitem"
						>
							<AppCatalogCard
								app={app}
								connected={connectedServices.has(app.service)}
								connectionStatusIsPending={connectionStatusIsPending}
								organizationSlug={input.organizationSlug}
							/>
						</FluidCardItem>
					))}
				</FluidCardGroup>
			) : (
				<div className="px-5 py-12 text-center">
					<p className="font-medium text-foreground text-sm">No Apps found</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Try another search or category.
					</p>
				</div>
			)}
		</section>
	);
}

function AppCatalogCard(input: {
	app: AppDefinition;
	connected: boolean;
	connectionStatusIsPending: boolean;
	organizationSlug: string;
}) {
	return (
		<Card className="h-full gap-0 bg-transparent py-0" size="sm">
			<CardContent className="h-full p-0">
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
					to={buildOrganizationAppPath({
						orgSlug: input.organizationSlug,
						service: input.app.service,
					})}
				>
					<AppLogo app={input.app} />
					<div className="min-w-0 flex-1">
						<h3 className="truncate font-medium text-foreground text-sm">
							{input.app.name}
						</h3>
						<p className="mt-1 truncate text-muted-foreground text-xs">
							{input.app.category}
						</p>
					</div>
					<span className="flex w-20 shrink-0 justify-end">
						<AppStatusBadge
							app={input.app}
							connected={input.connected}
							loading={input.connectionStatusIsPending}
						/>
					</span>
					<CaretRightIcon
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
					/>
				</Link>
			</CardContent>
		</Card>
	);
}

export function AppStatusBadge(input: {
	app: AppDefinition;
	connected?: boolean;
	loading?: boolean;
}) {
	if (input.app.availability === "planned") {
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
				data-testid="app-connection-status-skeleton"
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
