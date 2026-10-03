import type {
	ListOrganizationSkillsResponse,
	OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { CheckboxGroup, CheckboxItem } from "@openmeld/ui/fluid/checkbox-group";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
	deleteCurrentOrganizationSkill,
	resolveOrganizationSkillErrorMessage,
} from "#/lib/organizations/organization-skills";
import { organizationSkillQueryKeys } from "#/query/organizations/organization-skills";

export function OrganizationSkillsSelection(input: {
	onDone: () => void;
	organizationId: string;
	organizationName: string;
	selectAllRef: RefObject<HTMLButtonElement | null>;
	skills: OrganizationSkillSummary[];
}) {
	const queryClient = useQueryClient();
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [confirmation, setConfirmation] = useState<{
		skills: OrganizationSkillSummary[];
		open: boolean;
	} | null>(null);
	// Retain the reviewed names during the dialog's closing transition.
	const closeConfirmation = () =>
		setConfirmation((current) =>
			current ? { ...current, open: false } : null
		);
	const [completed, setCompleted] = useState(0);
	const removeRef = useRef<HTMLButtonElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const doneRef = useRef<HTMLButtonElement>(null);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const selected = input.skills.filter((skill) => selectedIds.has(skill.id));
	const allSelected =
		selected.length > 0 && selected.length === input.skills.length;
	const removal = useMutation({
		mutationFn: async (skills: OrganizationSkillSummary[]) => {
			const removed = new Set<string>();
			const failures: { skill: OrganizationSkillSummary; message: string }[] =
				[];
			setCompleted(0);
			// Keep requests bounded and stop starting work after leaving this catalog.
			for (const skill of skills) {
				if (!active.current) {
					break;
				}
				try {
					await deleteCurrentOrganizationSkill({
						expectedOrganizationId: input.organizationId,
						expectedVersion: skill.version,
						skillId: skill.id,
					});
					removed.add(skill.id);
					queryClient.removeQueries({
						queryKey: organizationSkillQueryKeys.detail(
							input.organizationId,
							skill.id
						),
					});
				} catch (error) {
					failures.push({
						skill,
						message: resolveOrganizationSkillErrorMessage(error, "remove"),
					});
				}
				if (active.current) {
					setCompleted(removed.size + failures.length);
				}
			}
			// Cancel older reads before removing confirmed successes from the cache.
			const queryKey = organizationSkillQueryKeys.list(input.organizationId);
			await queryClient.cancelQueries({ queryKey });
			queryClient.setQueryData<ListOrganizationSkillsResponse>(
				queryKey,
				(previous) =>
					previous
						? {
								...previous,
								skills: previous.skills.filter(
									(skill) => !removed.has(skill.id)
								),
							}
						: previous
			);
			queryClient.invalidateQueries({ queryKey }).catch(console.error);
			return { removed: removed.size, failures };
		},
		onSuccess: (result) => {
			if (!active.current) {
				return;
			}
			closeConfirmation();
			setSelectedIds(new Set(result.failures.map(({ skill }) => skill.id)));
		},
	});
	const count = confirmation?.skills.length ?? 0;
	const confirmationLabel =
		count === 1 ? "Remove 1 skill" : `Remove ${count} skills`;
	return (
		<>
			<div className="sticky top-0 z-10 -my-2 flex flex-wrap items-center gap-2 border-border border-b bg-background py-3">
				<output className="mr-2 text-sm">{selected.length} selected</output>
				<Button
					disabled={input.skills.length === 0 || removal.isPending}
					onClick={() =>
						setSelectedIds(
							allSelected
								? new Set()
								: new Set(input.skills.map((skill) => skill.id))
						)
					}
					ref={input.selectAllRef}
					size="sm"
					variant="ghost"
				>
					{allSelected
						? "Clear selection"
						: `Select all ${input.skills.length}`}
				</Button>
				<div className="ml-auto flex items-center gap-2">
					<Button
						disabled={selected.length === 0 || removal.isPending}
						onClick={() => setConfirmation({ skills: selected, open: true })}
						ref={removeRef}
						size="sm"
						variant="destructive"
					>
						<TrashIcon aria-hidden="true" />
						{selected.length === 1
							? "Remove 1 skill"
							: `Remove ${selected.length} skills`}
					</Button>
					<Button
						disabled={removal.isPending}
						onClick={input.onDone}
						ref={doneRef}
						size="sm"
						variant="outline"
					>
						Done
					</Button>
				</div>
			</div>
			{removal.data && (
				<div
					className="grid gap-2 text-sm"
					role={removal.data.failures.length ? "alert" : "status"}
				>
					<p>
						{removal.data.removed === 1
							? "1 skill removed."
							: `${removal.data.removed} skills removed.`}
						{removal.data.failures.length > 0
							? ` ${removal.data.failures.length} could not be removed. Review the errors and try again.`
							: ""}
					</p>
					{removal.data.failures.length > 0 && (
						<ScrollArea className="max-h-40">
							<ul className="grid gap-2">
								{removal.data.failures.map(({ skill, message }) => (
									<li key={skill.id}>
										<span className="font-medium">{skill.name}</span>: {message}
									</li>
								))}
							</ul>
						</ScrollArea>
					)}
				</div>
			)}
			{input.skills.length === 0 ? (
				<p className="text-muted-foreground text-sm">No skills to select.</p>
			) : (
				<CheckboxGroup
					aria-label="Select skills"
					checkedIndices={
						new Set(
							input.skills.flatMap((skill, index) =>
								selectedIds.has(skill.id) ? [index] : []
							)
						)
					}
					className="grid w-full @min-[760px]/skills:grid-cols-2 gap-3"
					mergeSelections={false}
				>
					{input.skills.map((skill, index) => (
						<CheckboxItem
							checked={selectedIds.has(skill.id)}
							className="min-h-36 border border-border p-4"
							cornerAdornment={
								<Badge variant={skill.enabled ? "secondary" : "outline"}>
									{skill.enabled ? "Enabled" : "Disabled"}
								</Badge>
							}
							description={
								<span className="flex min-h-24 flex-col">
									<span className="line-clamp-2 text-sm">
										{skill.description}
									</span>
									<span className="mt-auto pt-4 text-xs">
										{skill.source.kind === "github" ? "GitHub" : "OpenMeld"}
										{" · "}
										<time dateTime={skill.updatedAt}>
											{new Intl.DateTimeFormat("en-US", {
												dateStyle: "medium",
											}).format(new Date(skill.updatedAt))}
										</time>
									</span>
								</span>
							}
							disabled={removal.isPending}
							index={index}
							key={skill.id}
							label={skill.name}
							labelClassName="pr-16 text-foreground text-sm"
							onToggle={() =>
								setSelectedIds((previous) => {
									const next = new Set(previous);
									if (next.has(skill.id)) {
										next.delete(skill.id);
									} else {
										next.add(skill.id);
									}
									return next;
								})
							}
						/>
					))}
				</CheckboxGroup>
			)}
			<Dialog
				onOpenChange={(open) => {
					if (!(open || removal.isPending)) {
						closeConfirmation();
					}
				}}
				open={confirmation?.open ?? false}
			>
				<DialogContent
					finalFocus={selected.length > 0 ? removeRef : doneRef}
					initialFocus={cancelRef}
					showCloseButton={!removal.isPending}
					size="lg"
				>
					<DialogHeader>
						<DialogTitle>
							{count === 1 ? "Remove 1 skill?" : `Remove ${count} skills?`}
						</DialogTitle>
						<DialogDescription>
							{count === 1
								? `This skill will be removed from ${input.organizationName}. Agents will no longer be able to load it.`
								: `These skills will be removed from ${input.organizationName}. Agents will no longer be able to load them.`}{" "}
							Work already in progress is not affected.
						</DialogDescription>
					</DialogHeader>
					<ScrollArea className="max-h-60 rounded-md border border-border">
						<ul className="divide-y divide-border">
							{confirmation?.skills.map((skill) => (
								<li className="break-words px-3 py-2 text-sm" key={skill.id}>
									{skill.name}
								</li>
							))}
						</ul>
					</ScrollArea>
					{removal.isPending && (
						<output className="text-muted-foreground text-sm">
							Removing skills… {completed} of {count} complete
						</output>
					)}
					<DialogFooter>
						<Button
							disabled={removal.isPending}
							onClick={closeConfirmation}
							ref={cancelRef}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={removal.isPending}
							onClick={() => {
								if (confirmation && !removal.isPending) {
									removal.mutate(confirmation.skills);
								}
							}}
							variant="destructive"
						>
							{removal.isPending ? "Removing…" : confirmationLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
