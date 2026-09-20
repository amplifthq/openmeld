import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import { createSpaceInOrganization } from "#/lib/spaces/create-space-in-organization";
import {
	openCurrentDirectMessageSpace,
	resolveDirectMessageOpenErrorMessage,
} from "#/lib/spaces/direct-message";
import { organizationSpaceProfileCandidatesQueryOptions } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { PeopleAgentPickerDialog } from "./people-agent-picker-dialog";
import {
	buildOrganizationDirectoryAddCandidates,
	filterAddMemberGroups,
} from "./people-agent-picker-model";

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
	// Retain a successful create while membership is retried, rather than creating another Space.
	const [pendingSpace, setPendingSpace] = useState<{
		spaceId: string;
		directoryProfileIds: string[];
		expectedCenterAgentProfileId?: string;
	} | null>(null);
	const createdSpaceId = pendingSpace?.spaceId ?? null;
	const directory = useQuery(
		organizationSpaceProfileCandidatesQueryOptions({
			organizationId: org.id,
			enabled: input.open,
		})
	);
	const navigate = useNavigate();
	const client = useQueryClient();
	const candidates = buildOrganizationDirectoryAddCandidates({
		directory: directory.data ?? null,
		organizationName: org.name,
		snapshot: null,
	});
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
	const hasSelection = pendingSpace !== null || selection.length > 0;
	const close = () => {
		input.onOpenChange(false);
		setSelected(new Set());
		setQuery("");
		setError(null);
		setPendingSpace(null);
	};
	const openGroupSpace = async () => {
		if (!defaultHumanProfile) {
			return;
		}
		let pending = pendingSpace;
		if (!pending) {
			const response = await createSpaceInOrganization({
				actingProfile: defaultHumanProfile,
				organizationId: org.id,
				space: {
					name: selection
						.map((candidate) => candidate.profileName)
						.join(", ")
						.slice(0, 80),
					accessMode: "members_only",
					visibility: "private",
				},
			});
			const center = selection.find((candidate) => candidate.isCenterAgent);
			pending = {
				spaceId: response.spaceId,
				directoryProfileIds: selection.map((candidate) => candidate.profileId),
				...(center ? { expectedCenterAgentProfileId: center.profileId } : {}),
			};
			setPendingSpace(pending);
		}
		const { spaceId } = pending;
		await createOrganizationScopedWebSpaceApi({
			organizationId: org.id,
			openMeldProfileId: defaultHumanProfile.openMeldProfileId,
		}).addOrganizationDirectoryProfilesToSpace(pending);
		await client.invalidateQueries({
			queryKey: accountSpaceQueryKeys.all,
			refetchType: "none",
		});
		await navigate({
			to: buildOrganizationSpacePath({
				orgSlug: org.slug,
				spaceId,
				search: { profileId: defaultHumanProfile.openMeldProfileId },
			}),
		});
	};
	const submit = async () => {
		if (submittingRef.current || !defaultHumanProfile || !hasSelection) {
			return;
		}
		submittingRef.current = true;
		setSubmitting(true);
		setError(null);
		try {
			if (multiple || pendingSpace) {
				await openGroupSpace();
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
			if (multiple || pendingSpace) {
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
	if (createdSpaceId) {
		submitLabel = "Retry adding members";
	}
	if (submitting) {
		submitLabel = "Opening…";
	}
	return (
		<PeopleAgentPickerDialog
			candidateGroups={filterAddMemberGroups(
				groups,
				query.trim().toLocaleLowerCase()
			)}
			canSubmit={
				Boolean(defaultHumanProfile) &&
				(pendingSpace !== null || selection.length > 0) &&
				!directory.isPending &&
				!directory.isError
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
				<>
					{createdSpaceId && (
						<p className="text-muted-foreground text-xs">
							Your Space was created. Retry to finish adding the selected
							members.
						</p>
					)}
					{!createdSpaceId &&
						multiple &&
						selection.some(
							(candidate) =>
								candidate.profileKind === "agent" && !candidate.isCenterAgent
						) && (
							<p className="text-muted-foreground text-xs">
								Agent owners will also join the Space.
							</p>
						)}
				</>
			}
			onClear={() => {
				if (!createdSpaceId) {
					setSelected(new Set());
				}
			}}
			onOpenChange={input.onOpenChange}
			onQueryChange={setQuery}
			onRetry={
				directory.isError
					? () => {
							directory.refetch();
						}
					: undefined
			}
			onSubmit={() => {
				submit();
			}}
			onToggle={(id) => {
				if (createdSpaceId) {
					return;
				}
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
			selectionDisabled={createdSpaceId !== null}
			submitLabel={submitLabel}
			title="New message"
		/>
	);
}
