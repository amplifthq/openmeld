"use client";

import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { Label } from "@openmeld/ui/components/label";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useId } from "react";

export type AgentProfileOwnerMode = "self" | "teammate";

type DirectoryMember = OrganizationDirectoryResponse["members"][number];

export function AgentProfileOwnerChoice(input: {
	currentUserId: string;
	disabled: boolean;
	members: readonly DirectoryMember[];
	mode: AgentProfileOwnerMode;
	onModeChange: (mode: AgentProfileOwnerMode) => void;
	onTargetOwnerChange: (userId: string) => void;
	targetOwnerUserId: string;
}) {
	const headingId = useId();
	const teammates = input.members.filter(
		(member) => member.userId !== input.currentUserId
	);
	const selectedTeammate = teammates.find(
		(member) => member.userId === input.targetOwnerUserId
	);

	return (
		<div className="grid gap-3">
			<p className="font-medium text-foreground text-sm" id={headingId}>
				Who will own this Agent?
			</p>
			<RadioGroup
				aria-disabled={input.disabled || undefined}
				aria-labelledby={headingId}
				className="grid gap-1 sm:grid-cols-2"
				selectedIndex={input.mode === "self" ? 0 : 1}
			>
				<RadioItem
					className="px-4 py-3"
					description="Create an Agent that you own and can use right away."
					index={0}
					label="Me"
					onSelect={() => {
						if (!input.disabled) {
							input.onModeChange("self");
						}
					}}
					selected={input.mode === "self"}
				/>
				<RadioItem
					aria-disabled={teammates.length === 0 || undefined}
					className={`px-4 py-3 ${teammates.length === 0 ? "cursor-not-allowed opacity-60" : ""}`}
					description="Ask a teammate to approve an Agent that they will own."
					index={1}
					label="A teammate"
					onSelect={() => {
						if (!(input.disabled || teammates.length === 0)) {
							input.onModeChange("teammate");
						}
					}}
					selected={input.mode === "teammate"}
				/>
			</RadioGroup>
			{input.mode === "teammate" ? (
				<div className="grid gap-2">
					<Label htmlFor="create-agent-owner-select">Agent owner</Label>
					<Select
						disabled={input.disabled}
						onValueChange={input.onTargetOwnerChange}
						value={input.targetOwnerUserId}
					>
						<SelectTrigger
							displayValue={selectedTeammate?.user.name ?? "Choose a teammate"}
							id="create-agent-owner-select"
						/>
						<SelectContent>
							{teammates.map((member, index) => (
								<SelectItem
									index={index}
									key={member.userId}
									value={member.userId}
								>
									{member.user.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-muted-foreground text-xs leading-5">
						Their approval settings decide whether this is created now or sent
						as a request.
					</p>
				</div>
			) : null}
		</div>
	);
}
