import type {
	AgentActivityInventorySession,
	AgentActivityInventorySessionOrigin,
	AgentActivityInventorySessionStatus,
	LocalAgentSessionProvider,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { XIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import {
	type CreateProfileAgentActivitySessionPreset,
	CreateProfileDialog,
} from "#/components/profiles/create-profile-dialog";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import {
	agentActivityQueryKeys,
	agentActivitySessionsQueryOptions,
} from "#/query/organizations/agent-activity";
import { AgentActivityAddToSpaceDialog } from "./agent-activity-add-to-space-dialog";
import { useAgentActivityData } from "./agent-activity-page";
import {
	CoverageNotice,
	SessionFilterSelect,
	SessionsEmptyMessage,
} from "./agent-activity-session-inventory-controls";
import {
	ORIGIN_OPTIONS,
	PROVIDER_OPTIONS,
	STATUS_OPTIONS,
} from "./agent-activity-session-inventory-options";
import {
	type AgentActivitySessionAction,
	AgentActivitySessionInventoryTable,
} from "./agent-activity-session-inventory-table";

const PAGE_SIZE = 50;

export type AgentActivitySessionsFilters = {
	cursor: string | null;
	memberUserId: string | null;
	origin: AgentActivityInventorySessionOrigin | null;
	provider: LocalAgentSessionProvider | null;
	query: string | null;
	status: AgentActivityInventorySessionStatus | null;
};

type ProfileDialogState = {
	mode: "create" | "resume";
	session: AgentActivityInventorySession;
};

export function AgentActivitySessions(input: {
	filters: AgentActivitySessionsFilters;
	onFiltersChange: (filters: AgentActivitySessionsFilters) => void;
}) {
	const data = useAgentActivityData();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [searchValue, setSearchValue] = useState(input.filters.query ?? "");
	const [profileDialog, setProfileDialog] = useState<ProfileDialogState | null>(
		null
	);
	const [spaceSession, setSpaceSession] =
		useState<AgentActivityInventorySession | null>(null);
	const inventoryQuery = useQuery(
		agentActivitySessionsQueryOptions({
			...(input.filters.cursor ? { cursor: input.filters.cursor } : {}),
			limit: PAGE_SIZE,
			...(input.filters.memberUserId
				? { memberUserId: input.filters.memberUserId }
				: {}),
			...(input.filters.origin ? { origin: input.filters.origin } : {}),
			...(data.projectScopeId ? { projectId: data.projectScopeId } : {}),
			...(input.filters.provider ? { provider: input.filters.provider } : {}),
			...(input.filters.query ? { query: input.filters.query } : {}),
			...(input.filters.status ? { status: input.filters.status } : {}),
			organizationId: data.organizationId,
		})
	);

	useEffect(() => {
		setSearchValue(input.filters.query ?? "");
	}, [input.filters.query]);

	const hasFilters =
		input.filters.memberUserId !== null ||
		input.filters.origin !== null ||
		input.filters.provider !== null ||
		input.filters.query !== null ||
		input.filters.status !== null;
	const emptyMessage = (
		<SessionsEmptyMessage
			clearFilters={() =>
				input.onFiltersChange({
					cursor: null,
					memberUserId: null,
					origin: null,
					provider: null,
					query: null,
					status: null,
				})
			}
			coverage={inventoryQuery.data?.coverage ?? []}
			hasFilters={hasFilters}
			isError={inventoryQuery.isError}
			isPending={inventoryQuery.isPending}
			projectCount={data.projects.length}
		/>
	);
	const updateFilters = (patch: Partial<AgentActivitySessionsFilters>) => {
		input.onFiltersChange({ ...input.filters, ...patch, cursor: null });
	};
	const handleSessionAction = (
		action: AgentActivitySessionAction,
		session: AgentActivityInventorySession
	) => {
		if (action === "add_to_space") {
			setSpaceSession(session);
			return;
		}
		if (action === "fork_profile") {
			// canFork stays false until the provider-native Fork command is wired
			// through the authoritative Agent Profile creation owner.
			toast.info("Provider-native Fork is not available from Web yet.");
			return;
		}
		setProfileDialog({
			mode: action === "resume_profile" ? "resume" : "create",
			session,
		});
	};

	return (
		<section
			aria-labelledby="agent-activity-sessions-heading"
			className="grid gap-3"
		>
			<div>
				<h2
					className="font-medium text-xl"
					id="agent-activity-sessions-heading"
				>
					Sessions
				</h2>
				<p className="text-muted-foreground text-sm">
					Browse the Local Agent Sessions shared by connected Projects in this
					Organization. Session content stays on each member’s computer.
				</p>
			</div>
			<CoverageNotice coverage={inventoryQuery.data?.coverage ?? []} />
			<Card className="rounded-md py-0">
				<CardHeader className="border-b py-3">
					<CardTitle>Session inventory</CardTitle>
					<CardDescription>
						{String(inventoryQuery.data?.sessions.length ?? 0)} Sessions on this
						page
					</CardDescription>
				</CardHeader>
				<CardContent className="px-0">
					<div className="flex flex-wrap items-end gap-2 border-b px-3 py-3">
						<SessionFilterSelect
							label="Owner"
							onChange={(memberUserId) => updateFilters({ memberUserId })}
							options={Array.from(data.membersByUserId.entries())
								.map(([value, member]) => ({ label: member.name, value }))
								.sort((left, right) => left.label.localeCompare(right.label))}
							placeholder="All Owners"
							value={input.filters.memberUserId}
						/>
						<SessionFilterSelect
							label="Local Agent"
							onChange={(provider) =>
								updateFilters({
									provider: provider as LocalAgentSessionProvider | null,
								})
							}
							options={PROVIDER_OPTIONS}
							placeholder="All Local Agents"
							value={input.filters.provider}
						/>
						<SessionFilterSelect
							label="Status"
							onChange={(status) =>
								updateFilters({
									status: status as AgentActivityInventorySessionStatus | null,
								})
							}
							options={STATUS_OPTIONS}
							placeholder="All Statuses"
							value={input.filters.status}
						/>
						<SessionFilterSelect
							label="Origin"
							onChange={(origin) =>
								updateFilters({
									origin: origin as AgentActivityInventorySessionOrigin | null,
								})
							}
							options={ORIGIN_OPTIONS}
							placeholder="All Origins"
							value={input.filters.origin}
						/>
						<form
							className="flex min-w-64 flex-1 items-end gap-2"
							onSubmit={(event: FormEvent) => {
								event.preventDefault();
								updateFilters({ query: searchValue.trim() || null });
							}}
						>
							<label
								className="grid flex-1 gap-1 text-muted-foreground text-xs"
								htmlFor="agent-activity-session-search"
							>
								Title or Native Session ID
								<Input
									className="h-8"
									id="agent-activity-session-search"
									onChange={(event) => setSearchValue(event.target.value)}
									placeholder="Find a Session"
									type="search"
									value={searchValue}
								/>
							</label>
							<Button size="sm" type="submit" variant="outline">
								Search
							</Button>
						</form>
						{hasFilters ? (
							<Button
								onClick={() => {
									setSearchValue("");
									input.onFiltersChange({
										cursor: null,
										memberUserId: null,
										origin: null,
										provider: null,
										query: null,
										status: null,
									});
								}}
								size="sm"
								type="button"
								variant="ghost"
							>
								<XIcon aria-hidden="true" /> Clear
							</Button>
						) : null}
					</div>
					<AgentActivitySessionInventoryTable
						currentUserId={currentUserId}
						emptyMessage={emptyMessage}
						nowMs={data.currentTimeMs}
						onAction={handleSessionAction}
						onOpenProfile={(profileId) => {
							navigate({
								to: buildAgentProfilePath({
									orgSlug: currentOrganization.slug,
									profileId,
								}),
							}).catch((error: unknown) => {
								console.error("Failed to open Agent Profile.", error);
							});
						}}
						sessions={inventoryQuery.data?.sessions ?? []}
					/>
					<div className="flex items-center justify-between gap-3 border-t px-3 py-3">
						<p className="text-muted-foreground text-xs">
							Stable pages are ordered by most recent activity.
						</p>
						<div className="flex gap-2">
							{input.filters.cursor ? (
								<Button
									onClick={() =>
										input.onFiltersChange({ ...input.filters, cursor: null })
									}
									size="sm"
									type="button"
									variant="outline"
								>
									First page
								</Button>
							) : null}
							{inventoryQuery.data?.nextCursor ? (
								<Button
									onClick={() =>
										input.onFiltersChange({
											...input.filters,
											cursor: inventoryQuery.data?.nextCursor ?? null,
										})
									}
									size="sm"
									type="button"
								>
									Next page
								</Button>
							) : null}
						</div>
					</div>
				</CardContent>
			</Card>
			{profileDialog ? (
				<SessionCreateProfileDialog
					onClose={() => setProfileDialog(null)}
					onCreated={(profileId) => {
						queryClient
							.invalidateQueries({
								queryKey: agentActivityQueryKeys.organization(
									data.organizationId
								),
							})
							.catch((error: unknown) => {
								console.error("Failed to refresh Session Inventory.", error);
							});
						navigate({
							to: buildAgentProfilePath({
								orgSlug: currentOrganization.slug,
								profileId,
							}),
						}).catch((error: unknown) => {
							console.error("Failed to open the new Agent Profile.", error);
						});
					}}
					organizationId={currentOrganization.id}
					organizationName={currentOrganization.name}
					orgSlug={currentOrganization.slug}
					profileDialog={profileDialog}
				/>
			) : null}
			{spaceSession ? (
				<AgentActivityAddToSpaceDialog
					onOpenChange={(open) => {
						if (!open) {
							setSpaceSession(null);
						}
					}}
					open={true}
					organizationId={currentOrganization.id}
					session={spaceSession}
				/>
			) : null}
		</section>
	);
}

function SessionCreateProfileDialog(input: {
	onClose: () => void;
	onCreated: (profileId: string) => void;
	organizationId: string;
	organizationName: string;
	orgSlug: string;
	profileDialog: ProfileDialogState;
}) {
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		loadSetupState: false,
	});
	return (
		<CreateProfileDialog
			agentActivitySessionPreset={toCreationPreset(input.profileDialog)}
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			onProfileCreated={(profile) => input.onCreated(profile.openMeldProfileId)}
			open={true}
			organizationAuthorizationContext={{
				organizationId: input.organizationId,
				organizationName: input.organizationName,
			}}
			organizationId={input.organizationId}
			orgSlug={input.orgSlug}
			recovery={recovery}
		/>
	);
}

function toCreationPreset(
	input: ProfileDialogState
): CreateProfileAgentActivitySessionPreset {
	return {
		agentControllerRef: input.session.localAgent.agentControllerRef,
		computerId: input.session.computer.id,
		localAgentName: input.session.localAgent.name,
		mode: input.mode,
		nativeSessionId: input.session.nativeSessionId,
		nativeSessionTitle: input.session.nativeSessionTitle,
		organizationId: input.session.organization.id,
		ownerUserId: input.session.owner.userId,
		projectId: input.session.project.id,
		provider: input.session.localAgent.provider,
		status: input.session.status,
	};
}
