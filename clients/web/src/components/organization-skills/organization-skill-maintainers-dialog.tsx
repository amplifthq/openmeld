"use client";

import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export function OrganizationSkillMaintainersDialog(input: {
	errorMessage?: string | null;
	finalFocus?: RefObject<HTMLButtonElement | null>;
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
			<div className="grid gap-2" role="alert">
				<p className="text-destructive text-sm">
					Could not load workspace members.
				</p>
				<Button onClick={() => directoryQuery.refetch()} variant="outline">
					Retry
				</Button>
			</div>
		);
	} else {
		memberContent = (
			<ScrollArea className="max-h-72 w-full">
				<CheckboxGroup
					aria-label="Skill Maintainers"
					checkedIndices={checkedIndices}
				>
					{members.map((member, index) => (
						<CheckboxItem
							checked={selection.has(member.userId)}
							description={member.user.email}
							disabled={input.saving}
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
			</ScrollArea>
		);
	}
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!input.saving) {
					input.onOpenChange(open);
				}
			}}
			open={input.open}
		>
			<DialogContent
				finalFocus={input.finalFocus}
				showCloseButton={!input.saving}
				size="lg"
			>
				<DialogHeader>
					<DialogTitle>Skill Maintainers</DialogTitle>
					<DialogDescription>
						Choose members who can edit this skill. Only workspace admins can
						manage access and availability.
					</DialogDescription>
				</DialogHeader>
				{memberContent}
				{input.errorMessage && (
					<p className="text-destructive text-sm" role="alert">
						{input.errorMessage}
					</p>
				)}
				<DialogFooter>
					<Button
						disabled={input.saving}
						onClick={() => input.onOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!directoryQuery.isSuccess || input.saving}
						onClick={() => input.onSave([...selection])}
					>
						{input.saving ? "Saving…" : "Save maintainers"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
