import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { organizationSpaceProfileCandidatesQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { useCreateSpace } from "#/query/spaces/space-creation";
import { PeopleAgentPickerDialog } from "./people-agent-picker-dialog";
import {
	buildOrganizationDirectoryAddCandidates,
	filterAddMemberGroups,
} from "./people-agent-picker-model";
import { useCreatedPickerAgents } from "./use-created-picker-agents";

export function NewChatDialog(input: {
	groupId?: string;
	initialQuery?: string;
	onCreated?: (spaceId: string) => void | Promise<void>;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { currentOrganization: org, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const [query, setQuery] = useState(input.initialQuery ?? "");
	const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
	const [submitting, setSubmitting] = useState(false);
	const submittingRef = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const createSpace = useCreateSpace({
		organizationId: org.id,
		orgSlug: org.slug,
		actingProfile: defaultHumanProfile,
	});
	const directory = useQuery(
		organizationSpaceProfileCandidatesQueryOptions({
			organizationId: org.id,
			enabled: input.open,
		})
	);
	const navigate = useNavigate();
	const client = useQueryClient();
	const createdAgents = useCreatedPickerAgents({
		organizationId: org.id,
		directory: directory.data,
		groups: buildOrganizationDirectoryAddCandidates({
			directory: directory.data ?? null,
			organizationName: org.name,
			snapshot: null,
		}),
	});
	const candidates = createdAgents.groups;
	const groups = {
		...candidates,
		personGroups: candidates.personGroups.map((group) =>
			group.id === currentUserId ? { ...group, humanCandidate: null } : group
		),
	};
	const all = [
		...groups.organizationCandidates,
		...groups.personGroups.flatMap((group) => [
			...(group.humanCandidate ? [group.humanCandidate] : []),
			...group.agentCandidates,
		]),
	];
	const selection = all.filter((candidate) =>
		selected.has(candidate.profileId)
	);
	const multiple = selection.length > 1;
	const hasSelection = selection.length > 0;
	const close = () => {
		input.onOpenChange(false);
		setSelected(new Set());
		setQuery("");
		setError(null);
	};
	const submit = async () => {
		if (submittingRef.current || !defaultHumanProfile || !hasSelection) {
			return;
		}
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		try {
			if (multiple) {
				createSpace.mutate({
					name: selection
						.map((candidate) => candidate.profileName)
						.join(", ")
						.slice(0, 80),
					accessMode: "members_only",
					visibility: "private",
					members: selection.map(({ profileId, profileName }) => ({
						profileId,
						profileName,
					})),
					expectedCenterAgentProfileId: selection.find(
						(candidate) => candidate.isCenterAgent
					)?.profileId,
				});
			} else {
				const target = selection[0];
				if (target.isCenterAgent) {
					await navigate({
						to: buildOrganizationCenterAgentChatPath(org.slug, {
							draft: "new",
							group: input.groupId,
						}),
					});
				} else {
					const response = await openCurrentDirectMessageSpace({
						organizationId: org.id,
						targetProfileId: target.profileId,
					});
					await input.onCreated?.(response.spaceId);
					await client.invalidateQueries({
						queryKey: accountSpaceQueryKeys.all,
						refetchType: "none",
					});
					await navigate({
						to: buildOrganizationDirectMessagePath({
							orgSlug: org.slug,
							spaceId: response.spaceId,
							search: { profileId: response.memberProfileId },
						}),
					});
				}
			}
			close();
		} catch (cause) {
			if (multiple) {
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn’t finish opening the Space. Try again."
				);
			} else {
				setError(resolveDirectMessageOpenErrorMessage(cause));
			}
		} finally {
			submittingRef.current = false;
			setSubmitting(false);
		}
	};
	let submitLabel = multiple ? "Create Space" : "Start chat";
	if (submitting) {
		submitLabel = "Opening…";
	}
	return (
		<PeopleAgentPickerDialog
			candidateGroups={filterAddMemberGroups(
				groups,
				query.trim().toLocaleLowerCase(),
				selected
			)}
			canSubmit={
				Boolean(defaultHumanProfile) &&
				selection.length > 0 &&
				!createSpace.isPending
			}
			description="Choose people or agents. Select more than one to start a Space."
			emptyMessage={
				query
					? "No matching people or agents. Try another search."
					: "No people or agents are available yet."
			}
			errorMessage={
				error ?? (directory.isError ? "Couldn’t load people and agents." : null)
			}
			isLoading={directory.isPending}
			isSubmitting={submitting}
			notice={
				multiple &&
				selection.some(
					(candidate) =>
						candidate.profileKind === "agent" && !candidate.isCenterAgent
				) && (
					<p className="text-muted-foreground text-xs">
						Agent owners will also join the Space.
					</p>
				)
			}
			onAgentCreated={(agent) => {
				createdAgents.onCreated(agent);
				setQuery("");
				setSelected((current) => new Set([...current, agent.profileId]));
				setError(null);
			}}
			onClear={() => {
				setSelected(new Set());
			}}
			onOpenChange={input.onOpenChange}
			onQueryChange={setQuery}
			onRetry={
				directory.isError
					? () => {
							setError(null);
							directory.refetch();
						}
					: undefined
			}
			onSubmit={() => {
				submit();
			}}
			onToggle={(id) => {
				setSelected((current) => {
					const next = new Set(current);
					if (next.has(id)) {
						next.delete(id);
					} else {
						next.add(id);
					}
					return next;
				});
			}}
			open={input.open}
			query={query}
			selectedProfileIds={selected}
			submitLabel={submitLabel}
			title="New message"
		/>
	);
}
