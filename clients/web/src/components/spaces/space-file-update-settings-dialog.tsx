"use client";

import { HOSTED_REMOTE_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type { SpaceApi } from "@openmeld/api-client";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import {
	buildSpaceMemberDirectory,
	type SpaceMemberDirectoryEntry,
} from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildSpaceMemberDirectoryForStatusOrder,
	filterSpaceMemberDirectory,
} from "#/lib/spaces/presentation";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	buildSpaceMembersRoster,
	SpaceMembersRosterView,
} from "./space-members-roster";
import { SpaceProfileIcon } from "./space-profile-icon";

export function SpaceFileUpdateSettingsDialog(input: {
	api: SpaceApi;
	file: SpaceFileDescriptor;
	spaceId: string;
	profileId?: string;
	onClose: () => void;
}) {
	const queryClient = useQueryClient();
	const organization = useOptionalAppOrganization();
	const profileDirectory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: Boolean(organization),
			organizationId: organization?.currentOrganization.id ?? "",
		})
	);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<string[] | null>(null);
	const [baseVersion, setBaseVersion] = useState<number | null>(null);
	const queryKey = [
		"space-file-update-settings",
		input.spaceId,
		input.file.id,
		input.profileId,
	];
	const query = useQuery({
		queryKey,
		queryFn: async () => ({
			settings: await input.api.fileUpdateSettings({
				spaceId: input.spaceId,
				fileId: input.file.id,
				command: { action: "read" },
			}),
			members: await input.api.getMembersSnapshot({ spaceId: input.spaceId }),
		}),
		staleTime: 0,
	});
	useEffect(() => {
		if (selected === null && query.isSuccess && !query.isFetching) {
			setSelected(query.data.settings.recipientProfileIds);
			setBaseVersion(query.data.settings.version);
		}
	}, [selected, query.data, query.isSuccess, query.isFetching]);
	const save = useMutation({
		mutationFn: async () => {
			if (baseVersion === null || selected === null) {
				throw new Error("Wait for update settings to load.");
			}
			return await input.api.fileUpdateSettings({
				spaceId: input.spaceId,
				fileId: input.file.id,
				command: {
					action: "configure",
					baseVersion,
					recipientProfileIds: selected,
				},
			});
		},
		onSuccess: (settings) => {
			if (query.data) {
				queryClient.setQueryData(queryKey, { ...query.data, settings });
			}
			input.onClose();
		},
	});
	const directory = query.data
		? buildSpaceMemberDirectoryForStatusOrder(
				buildSpaceMemberDirectory(query.data.members)
			)
		: null;
	const centerAgentProfileId =
		profileDirectory.data?.agentProfiles.find(
			(profile) => profile.isCenterAgent
		)?.profileId ?? null;
	const roster = buildSpaceMembersRoster({
		centerAgentProfileId,
		directory,
		filteredDirectory: directory
			? filterSpaceMemberDirectory({ directory, query: search })
			: null,
		searchActive: search.trim().length > 0,
		owners: profileDirectory.data?.members,
	});
	const renderMember = (entry: SpaceMemberDirectoryEntry) => {
		const checked = selected?.includes(entry.profileId) ?? false;
		let description = "Agent";
		if (entry.profileKind === "human") {
			description = "Person";
		} else if (entry.profileId === centerAgentProfileId) {
			description = "Center Agent";
		} else if (
			entry.agentControllerRef === HOSTED_REMOTE_AGENT_CONTROLLER_REF
		) {
			description = "Remote Agent";
		}
		return (
			<CheckboxGroup
				checkedIndices={checked ? new Set([0]) : new Set()}
				className="w-full"
			>
				<CheckboxItem
					adornment={
						<SpaceProfileIcon
							agentControllerRef={entry.agentControllerRef}
							avatarImageUrl={entry.avatarUrl}
							isCenterAgent={entry.profileId === centerAgentProfileId}
							profileId={entry.profileId}
							profileKind={entry.profileKind}
							profileName={entry.profileName}
							size="sm"
						/>
					}
					checked={checked}
					description={description}
					disabled={save.isPending}
					index={0}
					label={entry.profileName}
					onToggle={() =>
						setSelected((current) =>
							current?.includes(entry.profileId)
								? current.filter((id) => id !== entry.profileId)
								: [...(current ?? []), entry.profileId]
						)
					}
				/>
			</CheckboxGroup>
		);
	};
	const error = save.error ?? query.error;
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || save.isPending)) {
					input.onClose();
				}
			}}
			open
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Notify on updates</DialogTitle>
					<DialogDescription>
						Choose who receives updates to {input.file.name}. People are
						notified; Agents are asked to review the new version. Select each
						separately, or clear all selections to turn notifications off.
					</DialogDescription>
				</DialogHeader>
				{query.isPending || (selected === null && query.isFetching) ? (
					<p>Loading members…</p>
				) : (
					<>
						<Input
							aria-label="Find people or agents"
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Find people or agents…"
							value={search}
						/>
						<div className="max-h-[min(28rem,50dvh)] overflow-y-auto">
							<SpaceMembersRosterView
								renderMember={renderMember}
								roster={roster}
								searchActive={search.trim().length > 0}
							/>
							{roster.organizationEntries.length +
								roster.personGroups.length +
								roster.ungroupedAgentEntries.length ===
							0 ? (
								<p className="py-4 text-muted-foreground text-sm">
									No matching members.
								</p>
							) : null}
						</div>
					</>
				)}
				{error ? (
					<p className="text-destructive text-sm" role="alert">
						{error.message}
					</p>
				) : null}
				<DialogFooter>
					<Button
						disabled={save.isPending}
						onClick={input.onClose}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!query.data || selected === null || save.isPending}
						onClick={() => save.mutate()}
					>
						{save.isPending ? "Saving…" : "Save"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
