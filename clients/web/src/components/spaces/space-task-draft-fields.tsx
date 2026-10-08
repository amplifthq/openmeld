import type { SignalText } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { XIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";

export type SpaceTaskDraft = NonNullable<SignalText["data"]["taskDraft"]>;
export type TaskDraftMember = { profileId: string; profileName: string };

export function TaskMemberSelect(input: {
	label: string;
	value: string;
	members: readonly TaskDraftMember[];
	disabled?: boolean;
	onChange: (value: string | null) => void;
}) {
	const id = useId();
	const [search, setSearch] = useState("");
	return (
		<div className="min-w-0">
			<label className="text-muted-foreground text-xs" htmlFor={id}>
				{input.label}
			</label>
			<Select
				onValueChange={(value) =>
					input.onChange(value === "none" ? null : value)
				}
				value={input.value || "none"}
			>
				<SelectTrigger
					className="mt-1 h-8 w-full text-xs"
					disabled={input.disabled}
					displayValue={
						input.members.find((member) => member.profileId === input.value)
							?.profileName ??
						(input.label === "Assignee" ? "Unassigned" : "None")
					}
					id={id}
				/>
				<SelectContent
					search={{
						placeholder: "Find a member",
						value: search,
						onValueChange: setSearch,
					}}
				>
					<SelectItem index={0} value="none">
						{input.label === "Assignee" ? "Unassigned" : "None"}
					</SelectItem>
					{input.members
						.filter((member) =>
							member.profileName.toLowerCase().includes(search.toLowerCase())
						)
						.map((member, index) => (
							<SelectItem
								index={index + 1}
								key={member.profileId}
								value={member.profileId}
							>
								{member.profileName}
							</SelectItem>
						))}
				</SelectContent>
			</Select>
		</div>
	);
}

export function SpaceTaskDraftFields(input: {
	draft: SpaceTaskDraft;
	members: readonly TaskDraftMember[];
	disabled?: boolean;
	onChange: (draft: SpaceTaskDraft) => void;
	onClose: () => void;
	closeLabel?: string;
}) {
	const id = useId();
	return (
		<div className="mb-3 space-y-3 border-border border-b pb-3">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">New task</span>
				<Button
					aria-label={input.closeLabel ?? "Back to message"}
					disabled={input.disabled}
					onClick={input.onClose}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<XIcon aria-hidden="true" />
				</Button>
			</div>
			<div>
				<label className="text-muted-foreground text-xs" htmlFor={id}>
					Title
				</label>
				<Input
					className="mt-1"
					disabled={input.disabled}
					id={id}
					maxLength={200}
					onChange={(event) =>
						input.onChange({ ...input.draft, title: event.target.value })
					}
					value={input.draft.title}
				/>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<TaskMemberSelect
					disabled={input.disabled}
					label="Assignee"
					members={input.members.filter(
						(member) => member.profileId !== input.draft.reviewerProfileId
					)}
					onChange={(value) =>
						input.onChange({ ...input.draft, assigneeProfileId: value })
					}
					value={input.draft.assigneeProfileId ?? ""}
				/>
				<TaskMemberSelect
					disabled={input.disabled}
					label="Reviewer"
					members={input.members.filter(
						(member) => member.profileId !== input.draft.assigneeProfileId
					)}
					onChange={(value) =>
						input.onChange({ ...input.draft, reviewerProfileId: value })
					}
					value={input.draft.reviewerProfileId ?? ""}
				/>
			</div>
		</div>
	);
}
