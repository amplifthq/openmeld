import type { AuthProfileView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { TabItem, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useMemo } from "react";
import { CenterAgentItem } from "#/components/directory/center-agent-item";
import { DirectorySearch } from "#/components/directory/directory-search";
import { MemberAgentAddableHarnesses } from "#/components/member-agents/member-agent-add-harnesses";
import { narrowMemberAgentDirectory } from "#/components/member-agents/member-agent-directory-model";
import { MemberAgentDirectorySection } from "#/components/member-agents/member-agent-directory-section";
import { useMemberAgentDirectory } from "#/components/member-agents/use-member-agent-directory";
import { DitherProfileAvatar } from "#/components/profiles/dither-profile-avatar";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	localAgentSidebarState,
	useAgentSidebarPreviewReady,
} from "#/lib/dev/agent-sidebar-fixtures";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationPersonPath } from "#/lib/organizations/organization-routes";
import { useBrowserPreference } from "#/lib/use-browser-preference";
import { AgentCreationRequestCard } from "./agent-creation-request-card";
import {
	AgentList,
	AgentListControls,
	AgentListFilterChips,
	type AgentListView,
	DEFAULT_AGENT_LIST_VIEW,
} from "./agent-list";
import {
	type AgentListItem,
	buildAgentListItem,
	matchesAgentListItem,
	sortAgentOwnerGroups,
} from "./agent-list-model";
import type { AgentCardSelection } from "./agent-list-selection";
import { AgentProfileSidebarItem } from "./agent-profile-sidebar-item";
import type { AgentProfilesWorkspaceProps } from "./agent-profiles-workspace";
import { useAgentListState } from "./use-agent-list-state";

const EMPTY_RUNTIME_OVERVIEW = new Map();

const DIRECTORY_AGENT_VIEW: AgentListView = {
	...DEFAULT_AGENT_LIST_VIEW,
	grouping: "controller-provider",
};

function resolveAgentDirectoryScope(
	input: AgentProfilesWorkspaceProps,
	savedScope: string | null
) {
	if (!input.person && savedScope === "mine") {
		return {
			myAgents: true,
			label: "My Agents",
			key: "my-agents",
			center: undefined,
			profiles: input.profiles.filter(
				(profile) =>
					profile.ownerUserId === input.currentUserId && !profile.managedRole
			),
			defaultView: DEFAULT_AGENT_LIST_VIEW,
		};
	}
	if (input.person) {
		return {
			myAgents: false,
			label: `${input.person.name}’s Agents`,
			key: input.person.id,
			center: undefined,
			profiles: input.profiles,
			defaultView: DIRECTORY_AGENT_VIEW,
		};
	}
	return {
		myAgents: false,
		label: null,
		key: null,
		center: input.directoryProfiles?.find((profile) => profile.isCenterAgent),
		profiles: input.profiles,
		defaultView: DIRECTORY_AGENT_VIEW,
	};
}

function AgentScopeTabs(input: {
	person?: AgentProfilesWorkspaceProps["person"];
	myAgents: boolean;
	onChange: (value: string) => void;
}) {
	if (input.person) {
		return null;
	}
	return (
		<Tabs
			onValueChange={input.onChange}
			value={input.myAgents ? "mine" : "all"}
		>
			<TabsList aria-label="Agent scope" className="w-fit max-w-full">
				<TabItem label="All Agents" value="all" />
				<TabItem label="My Agents" value="mine" />
			</TabsList>
		</Tabs>
	);
}

export function AgentDirectoryLists({
	input,
}: {
	input: AgentProfilesWorkspaceProps;
}) {
	const { currentOrganization } = useAppOrganization();
	const preferenceKey = `openmeld.agents.directory:${input.currentUserId}:${currentOrganization.id}`;
	const [savedScope, setScope] = useBrowserPreference(`${preferenceKey}:scope`);
	const scope = resolveAgentDirectoryScope(input, savedScope);
	const defaultView = scope.defaultView;
	const viewPreferenceKey = (personId: string) =>
		`openmeld.agents.presentation:${input.currentUserId}:${currentOrganization.id}:${personId}`;
	const previewReady = useAgentSidebarPreviewReady();
	const {
		search,
		setSearch,
		view: savedView,
		setView,
	} = useAgentListState(`${preferenceKey}:${input.person?.id ?? "directory"}`);
	const view = savedView ?? defaultView;
	const items = useMemo(
		() =>
			scope.profiles.map((profile) => {
				const preview = localAgentSidebarState(
					profile.openMeldProfileId,
					previewReady
				);
				return buildAgentListItem({
					profile,
					readiness: input.readinessByProfileId.get(profile.openMeldProfileId),
					agentControllerRef: input.agentControllerRefByProfileId?.get(
						profile.openMeldProfileId
					),
					lastTaskActivityAt: input.lastTaskActivityByProfileId?.get(
						profile.openMeldProfileId
					),
					modelCatalog: input.modelCatalog,
					availability:
						preview === "connect" ? "unavailable" : (preview ?? undefined),
				});
			}),
		[
			scope.profiles,
			input.readinessByProfileId,
			input.agentControllerRefByProfileId,
			input.lastTaskActivityByProfileId,
			input.modelCatalog,
			previewReady,
		]
	);
	const renderCard = (
		item: AgentListItem,
		index: number,
		selection?: AgentCardSelection
	) => (
		<AgentProfileSidebarItem
			agentControllerRef={
				input.agentControllerRefByProfileId?.get(
					item.profile.openMeldProfileId
				) ?? null
			}
			index={index}
			isActive={false}
			key={item.profile.openMeldProfileId}
			modelCatalog={input.modelCatalog ?? null}
			onSelectProfile={input.onSelectProfile}
			operationalContext={
				input.operationalContextByProfileId?.get(
					item.profile.openMeldProfileId
				) ?? null
			}
			profile={item.profile}
			readiness={
				input.readinessByProfileId.get(item.profile.openMeldProfileId) ?? null
			}
			readinessErrorMessage={
				input.readinessErrorByProfileId?.get(item.profile.openMeldProfileId) ??
				null
			}
			readinessIsPending={
				input.readinessPendingProfileIds?.has(item.profile.openMeldProfileId) ??
				false
			}
			selection={selection}
			variant="card"
			workload={resolveVisibleWorkload(
				input.runtimeOverviewByProfileId?.get(item.profile.openMeldProfileId)
					?.workload
			)}
		/>
	);
	const renderMemberAgents = useOwnMemberAgentResults({
		input,
		items,
		renderCard,
	});
	const create =
		input.canCreateAgent !== false ? (
			<Button onClick={input.onCreateAgent} size="sm">
				Create Agent
			</Button>
		) : undefined;
	const center = scope.center;
	const centerItem = center
		? buildAgentListItem({
				profile: { ...center, openMeldProfileId: center.profileId },
				agentControllerRef: center.agentControllerRef,
				readiness: input.readinessByProfileId.get(center.profileId),
				modelCatalog: input.modelCatalog,
			})
		: null;
	if (centerItem) {
		centerItem.searchText += ` ${currentOrganization.name.toLowerCase()} center agent`;
	}
	const showCenter = centerItem
		? matchesAgentListItem(centerItem, view.filters, search)
		: !search &&
			Object.values(view.filters).every((values) => values.length === 0);
	const creationRequests = (input.creationRequests ?? []).filter(
		(request) =>
			(!("requesterUserId" in request) ||
				request.requesterUserId === input.currentUserId) &&
			(!("createdAgentProfileId" in request) ||
				request.createdAgentProfileId === null) &&
			["creating", "pending", "approved", "failed"].includes(request.status)
	);
	const toolbar = (
		<div className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
			<AgentScopeTabs
				myAgents={scope.myAgents}
				onChange={setScope}
				person={input.person}
			/>
			{input.taskActivityAvailable === false && (
				<output className="text-muted-foreground text-xs">
					Task activity unavailable.
				</output>
			)}
			<div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
				<AgentListFilterChips
					defaults={defaultView}
					onChange={setView}
					value={view}
				/>
				<DirectorySearch
					label={scope.label ? "Search Agents" : "Search people or Agents"}
					onChange={setSearch}
					value={search}
				/>
				<AgentListControls
					items={centerItem ? [centerItem, ...items] : items}
					onChange={setView}
					resetValue={defaultView}
					value={view}
				/>
			</div>
		</div>
	);
	if (scope.key && scope.label) {
		return (
			<div className="space-y-3">
				{toolbar}
				<AgentList
					defaults={view}
					emptyAction={create}
					hideControls
					items={items}
					label={scope.label}
					onDelete={
						input.canCreateAgent !== false ? input.onDeleteProfiles : undefined
					}
					renderCard={renderCard}
					renderResults={ownAgentResults({
						ownScope: isOwnAgentScope(scope, input),
						render: renderMemberAgents,
					})}
					search={search}
					viewPreferenceKey={viewPreferenceKey(scope.key)}
				/>
			</div>
		);
	}
	const groups = sortAgentOwnerGroups(
		(input.members ?? []).map((member) => ({
			ownerUserId: member.userId,
			name: member.user.name,
			member,
			items: items.filter((item) => item.profile.ownerUserId === member.userId),
		})),
		input.currentUserId
	);
	const visibleGroups = groups.filter(
		(group) =>
			group.ownerUserId === input.currentUserId ||
			group.items.some((item) =>
				matchesAgentListItem(item, view.filters, search)
			)
	);
	return (
		<div
			aria-labelledby="team-directory-tab-2"
			className="space-y-7 [&>div:first-child]:mb-0"
			id="team-directory-panel-2"
			role="tabpanel"
		>
			<div>{toolbar}</div>
			{showCenter && (
				<section aria-label={currentOrganization.name} className="space-y-3">
					<h2 className="font-medium text-sm">{currentOrganization.name}</h2>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						<CenterAgentItem presentation="card" />
					</div>
				</section>
			)}
			{creationRequests.length > 0 ? (
				<section aria-label="Agents being created" className="space-y-3">
					<h2 className="font-medium text-sm">Creating</h2>
					<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
						{creationRequests.map((request) => (
							<AgentCreationRequestCard
								key={request.id}
								onDismiss={() => input.onDismissCreation?.(request.id)}
								onReview={() => {
									if ("requesterUserId" in request) {
										input.onOpenCreationRequest?.(request.id);
										return;
									}
									input.onCreateAgent();
								}}
								request={request}
							/>
						))}
					</div>
				</section>
			) : null}
			{visibleGroups.map((group) => {
				const heading = (
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<DitherProfileAvatar
							avatarImageUrl={group.member.user.image}
							profileId={
								group.member.humanProfile?.profileId ?? group.member.userId
							}
							profileKind="human"
							profileName={group.name}
							size={28}
						/>
						<h2 className="m-0 flex items-center truncate font-medium text-sm leading-none">
							<Link
								to={buildOrganizationPersonPath({
									orgSlug: currentOrganization.slug,
									personId:
										group.member.humanProfile?.profileId ??
										`member:${group.member.memberId}`,
								})}
							>
								{group.name}
							</Link>
							{group.ownerUserId === input.currentUserId && (
								<span className="ml-1 text-muted-foreground">(you)</span>
							)}
						</h2>
						{group.ownerUserId === input.currentUserId &&
							input.isOrganizationContext && (
								<Button
									onClick={() => input.onViewChange("requests")}
									size="sm"
									variant="secondary"
								>
									<ClockCounterClockwiseIcon />
									Creation history
									{input.creationAttentionCount > 0 && (
										<span className="rounded-full bg-muted px-1.5 text-xs">
											Needs attention: {input.creationAttentionCount}
										</span>
									)}
								</Button>
							)}
					</div>
				);
				return (
					<AgentList
						collapsible
						defaults={view}
						emptyAction={
							group.ownerUserId === input.currentUserId ? create : undefined
						}
						heading={heading}
						items={group.items}
						key={group.ownerUserId}
						label={`${group.name}’s Agents`}
						onDelete={
							group.ownerUserId === input.currentUserId
								? input.onDeleteProfiles
								: undefined
						}
						renderCard={renderCard}
						renderResults={ownAgentResults({
							ownScope: group.ownerUserId === input.currentUserId,
							render: renderMemberAgents,
						})}
						search={search}
						viewPreferenceKey={viewPreferenceKey(
							group.member.humanProfile?.profileId ??
								`member:${group.member.memberId}`
						)}
					/>
				);
			})}
			{visibleGroups.length === 0 && !showCenter && (
				<p className="text-muted-foreground text-sm">
					No Agents match. Try another search or clear filters.
				</p>
			)}
		</div>
	);
}

/** Counts only when the overview reports work the viewer may see. */
function resolveVisibleWorkload(
	workload:
		| NonNullable<
				ReturnType<
					NonNullable<
						AgentProfilesWorkspaceProps["runtimeOverviewByProfileId"]
					>["get"]
				>
		  >["workload"]
		| undefined
) {
	return workload?.status === "ready"
		? {
				runningCount: workload.activeCount,
				queuedCount: workload.queuedMessageCount,
			}
		: undefined;
}

function ownAgentResults<Render>(input: {
	ownScope: boolean;
	render: Render;
}): Render | undefined {
	return input.ownScope ? input.render : undefined;
}

function isOwnAgentScope(
	scope: { myAgents: boolean; profiles: readonly AuthProfileView[] },
	input: AgentProfilesWorkspaceProps
): boolean {
	return (
		scope.myAgents ||
		(Boolean(input.person) &&
			scope.profiles.length > 0 &&
			scope.profiles.every(
				(profile) => profile.ownerUserId === input.currentUserId
			))
	);
}

/**
 * The signed-in member's own Agents read one card per MemberAgent, then the
 * unassigned Profiles; the list's search, filters, and sort still apply to
 * the Profiles underneath. Undefined while the listing is unavailable, so
 * the list keeps its per-Profile cards.
 */
function useOwnMemberAgentResults(args: {
	input: AgentProfilesWorkspaceProps;
	items: readonly AgentListItem[];
	renderCard: (item: AgentListItem, index: number) => ReactNode;
}) {
	const memberAgentDirectory = useMemberAgentDirectory({
		profiles: args.input.profiles,
		runtimeByProfileId:
			args.input.runtimeOverviewByProfileId ?? EMPTY_RUNTIME_OVERVIEW,
	});
	const itemByProfileId = new Map(
		args.items.map((item) => [item.profile.openMeldProfileId, item])
	);
	const onOpenMemberAgent = args.input.onOpenMemberAgent;
	const { currentOrganization } = useAppOrganization();
	if (!(memberAgentDirectory && onOpenMemberAgent)) {
		return undefined;
	}
	const emptyActions = {
		connectComputerPath: buildConnectComputerPath({
			orgSlug: currentOrganization.slug,
		}),
		...(args.input.canCreateAgent === false
			? {}
			: { onCreateAgent: args.input.onCreateAgent }),
	};
	return (visible: readonly AgentListItem[], filtered: boolean) => (
		<MemberAgentDirectorySection
			// A filtered list shows only matches, never the Add offers.
			addable={filtered ? null : <MemberAgentAddableHarnesses />}
			directory={narrowMemberAgentDirectory({
				directory: memberAgentDirectory,
				visibleProfileIds: visible.map(
					(item) => item.profile.openMeldProfileId
				),
				filtered,
			})}
			emptyActions={emptyActions}
			label="Your Agents"
			onOpenMemberAgent={onOpenMemberAgent}
			renderUnassignedCard={(entry, index) => {
				const item = itemByProfileId.get(entry.profile.openMeldProfileId);
				return item ? args.renderCard(item, index) : null;
			}}
		/>
	);
}
