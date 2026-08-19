"use client";

import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { MonitorIcon, RobotIcon, UserIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { resolveOrganizationComputerGroups } from "#/components/computers/organization-computers";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { StaleDataNotice } from "#/components/stale-data-notice";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationPeoplePath,
} from "#/lib/organizations/organization-routes";
import { localRuntimesQueryOptions } from "#/query/connect/local-runtimes";
import {
	organizationComputersQueryOptions,
	organizationDirectoryQueryOptions,
} from "#/query/organizations/organization-directory";
import {
	OrganizationHomeEmpty,
	OrganizationHomeError,
	OrganizationHomeList,
	OrganizationHomeListItem,
	OrganizationHomeListSkeleton,
	OrganizationHomePanel,
	OrganizationHomeSection,
} from "./organization-home-ui";

const HOME_DIRECTORY_ITEM_LIMIT = 4;

export function OrganizationHomeDirectory() {
	const { currentOrganization, currentUserId, storageScope } =
		useAppOrganization();
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const localRuntimesQuery = useQuery(
		localRuntimesQueryOptions({ enabled: true, storageScope })
	);
	const organizationComputersQuery = useQuery(
		organizationComputersQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const directoryDataIsStale =
		directoryQuery.isError && Boolean(directoryQuery.data);
	const runtimeDataIsStale =
		localRuntimesQuery.isError && Boolean(localRuntimesQuery.data);
	const organizationComputersDataIsStale =
		organizationComputersQuery.isError &&
		Boolean(organizationComputersQuery.data);
	const detailsAreStale =
		directoryDataIsStale ||
		runtimeDataIsStale ||
		organizationComputersDataIsStale;
	const computers = resolveOrganizationComputerGroups({
		currentUserId,
		directory: directoryQuery.data ?? null,
		organizationComputers: organizationComputersQuery.data ?? null,
		ownedComputers: localRuntimesQuery.data?.localRuntimes ?? [],
	})
		.flatMap((group) => group.computers)
		.slice(0, HOME_DIRECTORY_ITEM_LIMIT);

	return (
		<OrganizationHomeSection title="Team">
			{detailsAreStale ? (
				<StaleDataNotice
					className="mx-0 mt-0"
					label="Team details may be out of date."
					onRetry={() =>
						Promise.all([
							directoryQuery.refetch(),
							localRuntimesQuery.refetch(),
							organizationComputersQuery.refetch(),
						])
					}
				/>
			) : null}
			<div className="grid min-w-0 gap-4 lg:grid-cols-3">
				<PeoplePanel
					directory={directoryQuery.data}
					isError={directoryQuery.isError && !directoryQuery.data}
					isPending={directoryQuery.isPending}
					isStale={directoryDataIsStale}
					onRetry={() => directoryQuery.refetch()}
					organizationSlug={currentOrganization.slug}
				/>
				<AgentsPanel
					directory={directoryQuery.data}
					isError={directoryQuery.isError && !directoryQuery.data}
					isPending={directoryQuery.isPending}
					isStale={directoryDataIsStale}
					onRetry={() => directoryQuery.refetch()}
					organizationSlug={currentOrganization.slug}
				/>
				<ComputersPanel
					computers={computers}
					isError={
						(directoryQuery.isError && !directoryQuery.data) ||
						(localRuntimesQuery.isError && !localRuntimesQuery.data) ||
						(organizationComputersQuery.isError &&
							!organizationComputersQuery.data)
					}
					isPending={
						directoryQuery.isPending ||
						localRuntimesQuery.isPending ||
						organizationComputersQuery.isPending
					}
					isStale={
						directoryDataIsStale ||
						runtimeDataIsStale ||
						organizationComputersDataIsStale
					}
					onRetry={() =>
						Promise.all([
							directoryQuery.refetch(),
							localRuntimesQuery.refetch(),
							organizationComputersQuery.refetch(),
						])
					}
					organizationSlug={currentOrganization.slug}
				/>
			</div>
		</OrganizationHomeSection>
	);
}

function PeoplePanel(input: DirectoryPanelInput) {
	const people = (input.directory?.members ?? []).slice(
		0,
		HOME_DIRECTORY_ITEM_LIMIT
	);
	const href = buildOrganizationPeoplePath(input.organizationSlug);
	return (
		<OrganizationHomePanel href={href} title="People">
			<DirectoryPanelState
				emptyIcon={<UserIcon aria-hidden="true" className="size-4" />}
				emptyLabel="No people yet"
				onRetry={input.onRetry}
				state={resolveDirectoryPanelState({
					isEmpty: people.length === 0,
					isError: input.isError,
					isPending: input.isPending,
					isStale: input.isStale,
				})}
			>
				<OrganizationHomeList>
					{people.map((member) => (
						<OrganizationHomeListItem
							href={href}
							icon={
								<DitherProfileAvatar
									avatarImageUrl={member.user.image}
									profileId={member.humanProfile?.profileId ?? member.userId}
									profileKind="human"
									profileName={member.user.name}
									size={32}
								/>
							}
							itemId={member.userId}
							key={member.userId}
							title={member.user.name}
						/>
					))}
				</OrganizationHomeList>
			</DirectoryPanelState>
		</OrganizationHomePanel>
	);
}

function AgentsPanel(input: DirectoryPanelInput) {
	const agents = (input.directory?.agentProfiles ?? [])
		.filter((profile) => profile.managedRole !== "center_agent")
		.slice(0, HOME_DIRECTORY_ITEM_LIMIT);
	const href = buildOrganizationAgentsPath(input.organizationSlug);
	return (
		<OrganizationHomePanel href={href} title="Agents">
			<DirectoryPanelState
				emptyIcon={<RobotIcon aria-hidden="true" className="size-4" />}
				emptyLabel="No Agents yet"
				onRetry={input.onRetry}
				state={resolveDirectoryPanelState({
					isEmpty: agents.length === 0,
					isError: input.isError,
					isPending: input.isPending,
					isStale: input.isStale,
				})}
			>
				<OrganizationHomeList>
					{agents.map((agent) => (
						<OrganizationHomeListItem
							href={href}
							icon={<RobotIcon aria-hidden="true" className="size-4" />}
							itemId={agent.profileId}
							key={agent.profileId}
							title={agent.profileName}
						/>
					))}
				</OrganizationHomeList>
			</DirectoryPanelState>
		</OrganizationHomePanel>
	);
}

function ComputersPanel(input: {
	computers: ReturnType<
		typeof resolveOrganizationComputerGroups
	>[number]["computers"];
	isError: boolean;
	isPending: boolean;
	isStale: boolean;
	onRetry: () => Promise<unknown>;
	organizationSlug: string;
}) {
	return (
		<OrganizationHomePanel
			href={buildOrganizationComputersPath(input.organizationSlug)}
			title="Computers"
		>
			<DirectoryPanelState
				emptyIcon={<MonitorIcon aria-hidden="true" className="size-4" />}
				emptyLabel="No Computers yet"
				onRetry={input.onRetry}
				state={resolveDirectoryPanelState({
					isEmpty: input.computers.length === 0,
					isError: input.isError,
					isPending: input.isPending,
					isStale: input.isStale,
				})}
			>
				<OrganizationHomeList>
					{input.computers.map((computer) => (
						<OrganizationHomeListItem
							href={buildOrganizationComputerPath({
								deviceId: computer.routeId,
								orgSlug: input.organizationSlug,
							})}
							icon={<MonitorIcon aria-hidden="true" className="size-4" />}
							itemId={computer.routeId}
							key={computer.routeId}
							meta={formatComputerMeta(
								computer.ownerLabel,
								computer.agents.length
							)}
							title={computer.deviceDisplayName}
						/>
					))}
				</OrganizationHomeList>
			</DirectoryPanelState>
		</OrganizationHomePanel>
	);
}

type DirectoryPanelInput = {
	directory: OrganizationDirectoryResponse | undefined;
	isError: boolean;
	isPending: boolean;
	isStale: boolean;
	onRetry: () => Promise<unknown>;
	organizationSlug: string;
};

function DirectoryPanelState(input: {
	children: React.ReactNode;
	emptyIcon: React.ReactNode;
	emptyLabel: string;
	onRetry: () => Promise<unknown>;
	state: "content" | "empty" | "error" | "pending";
}) {
	if (input.state === "pending") {
		return <OrganizationHomeListSkeleton />;
	}
	if (input.state === "error") {
		return (
			<OrganizationHomeError
				label="Couldn’t load this view."
				onRetry={() => input.onRetry()}
			/>
		);
	}
	if (input.state === "empty") {
		return (
			<OrganizationHomeEmpty icon={input.emptyIcon} label={input.emptyLabel} />
		);
	}
	return input.children;
}

function resolveDirectoryPanelState(input: {
	isEmpty: boolean;
	isError: boolean;
	isPending: boolean;
	isStale: boolean;
}): "content" | "empty" | "error" | "pending" {
	if (input.isPending) {
		return "pending";
	}
	if (input.isError) {
		return "error";
	}
	if (input.isEmpty && !input.isStale) {
		return "empty";
	}
	return "content";
}

function formatComputerMeta(ownerName: string, agentCount: number): string {
	if (agentCount === 0) {
		return ownerName;
	}
	return `${ownerName} · ${String(agentCount)} ${agentCount === 1 ? "Agent" : "Agents"}`;
}
