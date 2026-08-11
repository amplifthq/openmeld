"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export function OrganizationSkillMaintainersDialog(input: {
	onOpenChange: (open: boolean) => void;
	onSave: (maintainerUserIds: string[]) => void;
	open: boolean;
	organizationId: string;
	saving: boolean;
	selectedUserIds: string[];
}) {
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: input.open,
			organizationId: input.organizationId,
		})
	);
	const [selection, setSelection] = useState(
		() => new Set(input.selectedUserIds)
	);
	useEffect(() => {
		if (input.open) {
			setSelection(new Set(input.selectedUserIds));
		}
	}, [input.open, input.selectedUserIds]);
	const members = directoryQuery.data?.members ?? [];
	const checkedIndices = new Set(
		members.flatMap((member, index) =>
			selection.has(member.userId) ? [index] : []
		)
	);
	let memberContent: ReactNode;
	if (directoryQuery.isPending) {
		memberContent = <Skeleton className="h-40 w-full" />;
	} else if (directoryQuery.isError) {
		memberContent = (
			<p className="text-destructive text-sm" role="alert">
				OpenMeld could not load Organization members.
			</p>
		);
	} else {
		memberContent = (
			<CheckboxGroup
				aria-label="Skill Maintainers"
				checkedIndices={checkedIndices}
				className="max-h-72 w-full overflow-y-auto"
			>
				{members.map((member, index) => (
					<CheckboxItem
						checked={selection.has(member.userId)}
						description={member.user.email}
						index={index}
						key={member.userId}
						label={member.humanProfile?.profileName ?? member.user.name}
						onToggle={() => {
							const next = new Set(selection);
							if (next.has(member.userId)) {
								next.delete(member.userId);
							} else {
								next.add(member.userId);
							}
							setSelection(next);
						}}
					/>
				))}
			</CheckboxGroup>
		);
	}
	return (
		<Dialog
			onOpenChange={(open) => {
				input.onOpenChange(open);
			}}
			open={input.open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Skill Maintainers</DialogTitle>
					<DialogDescription>
						Maintainers can edit and save this Skill. They cannot install,
						enable, remove, or change maintainers.
					</DialogDescription>
				</DialogHeader>
				{memberContent}
				<DialogFooter>
					<Button
						disabled={input.saving}
						onClick={() => input.onOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={directoryQuery.isError || input.saving}
						onClick={() => input.onSave([...selection])}
					>
						{input.saving ? "Saving…" : "Save maintainers"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
