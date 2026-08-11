"use client";

import type { LocalRuntimeComputer } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon, DesktopTowerIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatComputerTabPlatform } from "#/components/agents/agents-page-computer";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationMemoryPath,
} from "#/lib/organizations/organization-routes";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";

export function CenterAgentPrivacyPage() {
	const { currentOrganization, storageScope } = useAppOrganization();
	const localRuntimesQuery = useQuery(
		localRuntimesQueryOptions({ enabled: true, storageScope })
	);
	return (
		<>
			<AppPageHeader
				description="Review what OpenMeld remembers about you and control which folders OpenMeld-started local agents can use."
				eyebrow="Personal"
				title="Privacy & Safety"
			/>
			<section className="overflow-hidden rounded-md border border-border/70 bg-card">
				<div className="border-border/70 border-b px-5 py-4">
					<h2 className="font-medium text-foreground text-sm">
						Center Agent memory
					</h2>
				</div>
				<div className="space-y-4 px-5 py-4">
					<p className="text-muted-foreground text-sm">
						Review what the Center Agent remembers about you, or erase that
						memory, from the Center Agent product home.
					</p>
					<Link
						className={buttonVariants({ size: "sm", variant: "outline" })}
						to={buildOrganizationMemoryPath(currentOrganization.slug)}
					>
						Open Center Agent Memory
					</Link>
				</div>
			</section>
			<section className="overflow-hidden rounded-md border border-border/70 bg-card">
				<div className="border-border/70 border-b px-5 py-4">
					<h2 className="font-medium text-foreground text-sm">
						Computer file access
					</h2>
				</div>
				<div className="space-y-4 px-5 py-4">
					<p className="text-muted-foreground text-sm">
						Choose which folders OpenMeld-started local agents can use on each
						of your computers.
					</p>
					<ComputerFileAccessLinks
						computers={localRuntimesQuery.data?.localRuntimes ?? []}
						currentDeviceId={localRuntimesQuery.data?.currentDeviceId ?? null}
						isError={localRuntimesQuery.isError}
						isPending={localRuntimesQuery.isPending}
						onRetry={() => localRuntimesQuery.refetch()}
						orgSlug={currentOrganization.slug}
					/>
				</div>
			</section>
		</>
	);
}

function ComputerFileAccessLinks(input: {
	computers: readonly LocalRuntimeComputer[];
	currentDeviceId: string | null;
	isError: boolean;
	isPending: boolean;
	onRetry: () => void;
	orgSlug: string;
}) {
	if (input.isPending) {
		return (
			<div aria-busy="true" className="grid gap-2 sm:grid-cols-2">
				<span className="sr-only">Loading your computers</span>
				<Skeleton className="h-20 motion-reduce:animate-none" />
				<Skeleton className="h-20 motion-reduce:animate-none" />
			</div>
		);
	}
	if (input.isError) {
		return (
			<div
				className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3"
				role="alert"
			>
				<p className="text-sm">OpenMeld couldn’t load your computers.</p>
				<Button onClick={input.onRetry} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}

	if (input.computers.length === 0) {
		return (
			<div className="rounded-md border border-border/70 bg-background/35 px-4 py-4">
				<p className="font-medium text-foreground text-sm">
					No computers connected
				</p>
				<p className="mt-1 max-w-xl text-muted-foreground text-xs leading-5">
					Connect a computer to choose which folders OpenMeld-started local
					agents can use.
				</p>
				<Link
					className={cn(
						buttonVariants({ size: "sm", variant: "outline" }),
						"mt-3"
					)}
					to={buildOrganizationComputersPath(input.orgSlug)}
				>
					Open Computers
				</Link>
			</div>
		);
	}
	const computers = [...input.computers].sort((left, right) => {
		if (left.deviceId === input.currentDeviceId) {
			return -1;
		}
		if (right.deviceId === input.currentDeviceId) {
			return 1;
		}
		return left.deviceDisplayName.localeCompare(right.deviceDisplayName);
	});

	return (
		<FluidCardGroup>
			<ul
				aria-label="Computers with file access settings"
				className="grid gap-2 sm:grid-cols-2"
			>
				{computers.map((computer) => {
					const isCurrentComputer = computer.deviceId === input.currentDeviceId;
					const canManage =
						isCurrentComputer && canManageComputerFileAccess(computer);
					const content = (
						<ComputerFileAccessRowContent
							canManage={canManage}
							computer={computer}
							isCurrentComputer={isCurrentComputer}
						/>
					);
					return (
						<li key={computer.deviceId}>
							<FluidCardItem
								className="h-full border border-border/70 bg-background/35"
								itemId={computer.deviceId}
							>
								{canManage ? (
									<Link
										aria-label={`Manage file access on ${computer.deviceDisplayName}`}
										className="flex h-full min-h-20 min-w-0 items-center gap-3 rounded-md px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
										search={{ focus: "file-access" }}
										to={buildOrganizationComputerPath({
											deviceId: computer.deviceId,
											orgSlug: input.orgSlug,
										})}
									>
										{content}
									</Link>
								) : (
									<div className="flex h-full min-h-20 min-w-0 items-center gap-3 px-3 py-3">
										{content}
									</div>
								)}
							</FluidCardItem>
						</li>
					);
				})}
			</ul>
		</FluidCardGroup>
	);
}

function ComputerFileAccessRowContent(input: {
	canManage: boolean;
	computer: LocalRuntimeComputer;
	isCurrentComputer: boolean;
}) {
	return (
		<>
			<span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
				<DesktopTowerIcon aria-hidden="true" className="size-4" />
			</span>
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium text-foreground text-sm">
						{input.computer.deviceDisplayName}
					</span>
					{input.isCurrentComputer ? (
						<Badge className="shrink-0" variant="secondary">
							This computer
						</Badge>
					) : null}
				</span>
				<span className="mt-1 block truncate text-muted-foreground text-xs">
					{formatComputerTabPlatform(input.computer)}
				</span>
				{input.canManage ? null : (
					<span className="mt-1 block text-muted-foreground text-xs leading-4">
						{resolveComputerFileAccessAction(input)}
					</span>
				)}
			</span>
			{input.canManage ? (
				<>
					<span className="hidden shrink-0 text-muted-foreground text-xs lg:inline">
						Manage file access
					</span>
					<ArrowRightIcon
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground/70"
					/>
				</>
			) : null}
		</>
	);
}

function resolveComputerFileAccessAction(input: {
	canManage: boolean;
	isCurrentComputer: boolean;
}): string {
	if (input.canManage) {
		return "Manage file access";
	}
	if (input.isCurrentComputer) {
		return "Connect or update OpenMeld Service";
	}
	return "Open OpenMeld on this computer to manage";
}

function canManageComputerFileAccess(computer: LocalRuntimeComputer): boolean {
	return (
		computer.computerFileAccess?.readPolicy === true &&
		computer.computerFileAccess.updatePolicy === true
	);
}
