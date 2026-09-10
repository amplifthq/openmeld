"use client";

import type { SpaceApi } from "@openmeld/api-client";
import type { SpaceFileDescriptor } from "@openmeld/schemas/types";
import { buildSpaceMemberDirectory } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export function SpaceFileUpdateSettingsDialog(input: {
	api: SpaceApi;
	file: SpaceFileDescriptor;
	spaceId: string;
	profileId?: string;
	onClose: () => void;
}) {
	const [selected, setSelected] = useState<string[] | null>(null);
	const [baseVersion, setBaseVersion] = useState<number | null>(null);
	const query = useQuery({
		queryKey: [
			"space-file-update-settings",
			input.spaceId,
			input.file.id,
			input.profileId,
		],
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
		if (selected === null && query.data) {
			setSelected(query.data.settings.recipientProfileIds);
			setBaseVersion(query.data.settings.version);
		}
	}, [selected, query.data]);
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
		onSuccess: input.onClose,
	});
	const entries = query.data
		? buildSpaceMemberDirectory(query.data.members).sections.flatMap(
				(section) => section.entries
			)
		: [];
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
						Choose who receives updates to {input.file.name}. Selected Agents
						will be asked to review each new version. Clear all selections to
						turn notifications off.
					</DialogDescription>
				</DialogHeader>
				{query.isPending ? (
					<p>Loading members…</p>
				) : (
					<div className="max-h-72 space-y-3 overflow-auto">
						{entries.map((entry) => (
							<label
								className="flex items-center gap-2 text-sm"
								htmlFor={`file-update-${entry.profileId}`}
								key={entry.profileId}
							>
								<input
									checked={selected?.includes(entry.profileId) ?? false}
									className="size-4 accent-primary"
									disabled={save.isPending}
									id={`file-update-${entry.profileId}`}
									onChange={(event) =>
										setSelected((current) =>
											event.target.checked
												? [...new Set([...(current ?? []), entry.profileId])]
												: (current ?? []).filter((id) => id !== entry.profileId)
										)
									}
									type="checkbox"
								/>
								<span>
									{entry.profileName}
									{entry.profileKind === "agent" ? " · Agent" : ""}
								</span>
							</label>
						))}
					</div>
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
