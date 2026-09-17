"use client";

import { spaceAccessModeUsesPassword } from "@openmeld/schemas";
import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { LockKeyIcon, PasswordIcon, UsersIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import {
	describeSpaceJoining,
	resolveSpaceLinkJoining,
	resolveSpaceLinkReading,
	type SpaceLinkJoining,
	type SpaceLinkReading,
	type SpaceSharingDraft,
	setSpaceLinkJoining,
	setSpaceLinkReading,
} from "./space-sharing-model";

export type SpaceAccessUpdateInput = {
	accessMode: SpaceAccessMode;
	allowGuests?: boolean;
	linkJoinPolicy?: SpaceLinkJoinPolicy;
	password?: string;
	visibility?: "public" | "private";
};

export const PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP =
	"Anyone with the link can read this Space, including people outside your organization.";

const READING_LABELS: Record<SpaceLinkReading, string> = {
	restricted: "Only Space members",
	anyone: "Anyone with the link",
	password: "Anyone with the password",
};

// The editor renders the deliberately different Share and Access disclosures from one policy draft.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the conditions keep reading, joining, password, and invitation controls aligned to one policy draft.
export function SpaceAccessEditor(input: {
	canManageAccess: boolean;
	currentAccessMode: SpaceAccessMode;
	disabled: boolean;
	draft: SpaceSharingDraft;
	errorMessage: string | null;
	onDraftChange: (draft: SpaceSharingDraft) => void;
	onInvitePeople?: () => void;
	onPasswordChange: (password: string) => void;
	organizationName?: string;
	password: string;
	surface: "settings" | "share";
}) {
	const passwordInputId = useId();
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const reading = resolveSpaceLinkReading(input.draft);
	const joining = resolveSpaceLinkJoining(input.draft);
	const joiningPresentation = describeSpaceJoining({
		draft: input.draft,
		organizationName: input.organizationName,
	});
	const currentModeHasPassword = spaceAccessModeUsesPassword(
		input.currentAccessMode
	);
	const selectedModeNeedsPassword = spaceAccessModeUsesPassword(
		input.draft.accessMode
	);
	const showPasswordInput =
		selectedModeNeedsPassword &&
		(!currentModeHasPassword || isChangingPassword);
	const isShare = input.surface === "share";
	const inviteButton = input.onInvitePeople ? (
		<Button
			className="shrink-0"
			disabled={input.disabled}
			onClick={input.onInvitePeople}
			size="sm"
			type="button"
			variant="secondary"
		>
			Invite people to join
		</Button>
	) : null;
	const passwordControl = showPasswordInput ? (
		<label className="block space-y-1" htmlFor={passwordInputId}>
			<span className="font-medium text-xs">
				{reading === "password" ? "Password to read" : "Password to join"}
			</span>
			<Input
				autoComplete="new-password"
				disabled={input.disabled}
				id={passwordInputId}
				onChange={(event) => input.onPasswordChange(event.target.value)}
				type="password"
				value={input.password}
			/>
			{reading === "password" && joining === "password" ? (
				<span className="block text-muted-foreground text-xs/relaxed">
					The same password is used to read and join.
				</span>
			) : null}
		</label>
	) : null;
	const passwordStatus =
		selectedModeNeedsPassword &&
		currentModeHasPassword &&
		!showPasswordInput ? (
			<div className="flex items-center justify-between gap-3">
				<p className="text-muted-foreground text-xs">Password is set.</p>
				{input.canManageAccess ? (
					<Button
						disabled={input.disabled}
						onClick={() => setIsChangingPassword(true)}
						size="xs"
						type="button"
						variant="secondary"
					>
						Change password
					</Button>
				) : null}
			</div>
		) : null;

	return (
		<div className="min-w-0 space-y-4">
			<section className="grid gap-2">
				<div className="space-y-0.5">
					<h3 className="font-medium text-sm">Who can read this Space?</h3>
					{isShare ? null : (
						<p className="text-muted-foreground text-xs/relaxed">
							Choose who can read this Space from its link.
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<div className="min-w-56 flex-1">
						<ReadingSelect
							disabled={input.disabled || !input.canManageAccess}
							onChange={(value) => {
								input.onDraftChange(setSpaceLinkReading(input.draft, value));
								setIsChangingPassword(false);
							}}
							value={reading}
						/>
					</div>
					{reading === "restricted" ? inviteButton : null}
				</div>
				<p className="text-muted-foreground text-xs/relaxed">
					{describeReading(reading, input.draft, input.organizationName)}
				</p>
				{reading === "password" ? (passwordStatus ?? passwordControl) : null}
			</section>

			{reading === "restricted" ? null : (
				<section
					className={
						isShare ? "grid gap-2" : "grid gap-2 border-border/60 border-t pt-4"
					}
				>
					<label
						className="font-medium text-sm"
						htmlFor={`${passwordInputId}-join`}
					>
						Who can join this Space?
					</label>
					<div className="flex flex-wrap items-center gap-2">
						<div className="min-w-56 flex-1">
							<JoiningSelect
								disabled={input.disabled || !input.canManageAccess}
								displayValue={joiningPresentation.label}
								draft={input.draft}
								id={`${passwordInputId}-join`}
								onChange={(value) => {
									input.onDraftChange(setSpaceLinkJoining(input.draft, value));
									setIsChangingPassword(false);
								}}
								organizationName={input.organizationName}
								reading={reading}
								value={joining}
							/>
						</div>
						{joining === "invite_only" ? inviteButton : null}
					</div>
					<p className="text-muted-foreground text-xs/relaxed">
						{joiningPresentation.description}
					</p>
					{joining === "password" && reading !== "password"
						? (passwordStatus ?? passwordControl)
						: null}
				</section>
			)}

			{input.canManageAccess ? null : (
				<p className="text-muted-foreground text-xs/relaxed">
					Only Space owners can change access.
				</p>
			)}
			{input.errorMessage ? (
				<p className="text-destructive text-xs" role="alert">
					{input.errorMessage}
				</p>
			) : null}
		</div>
	);
}

function ReadingSelect(input: {
	disabled: boolean;
	onChange: (value: SpaceLinkReading) => void;
	value: SpaceLinkReading;
}) {
	return (
		<Select
			disabled={input.disabled}
			onValueChange={(value) => input.onChange(value as SpaceLinkReading)}
			value={input.value}
		>
			<SelectTrigger
				aria-label="Who can read this Space?"
				className="w-full"
				displayValue={READING_LABELS[input.value]}
				icon={resolveReadingIcon(input.value)}
			/>
			<SelectContent matchTriggerWidth>
				<SelectItem icon={LockKeyIcon} index={0} value="restricted">
					Only Space members
				</SelectItem>
				<SelectItem icon={UsersIcon} index={1} value="anyone">
					Anyone with the link
				</SelectItem>
				<SelectItem icon={PasswordIcon} index={2} value="password">
					Anyone with the password
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

function JoiningSelect(input: {
	disabled: boolean;
	displayValue: string;
	draft: SpaceSharingDraft;
	id: string;
	onChange: (value: SpaceLinkJoining) => void;
	organizationName?: string;
	reading: SpaceLinkReading;
	value: SpaceLinkJoining;
}) {
	const optionLabels = resolveJoiningOptionLabels(input);
	return (
		<Select
			disabled={input.disabled}
			onValueChange={(value) => input.onChange(value as SpaceLinkJoining)}
			value={input.value}
		>
			<SelectTrigger
				aria-label="Who can join this Space?"
				className="w-full"
				displayValue={input.displayValue}
				id={input.id}
			/>
			<SelectContent matchTriggerWidth>
				<SelectItem index={0} value="invite_only">
					{optionLabels.invite_only}
				</SelectItem>
				{input.reading === "anyone" ? (
					<SelectItem index={1} value="anyone">
						{optionLabels.anyone}
					</SelectItem>
				) : null}
				<SelectItem index={2} value="password">
					{optionLabels.password}
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

function resolveJoiningOptionLabels(input: {
	draft: SpaceSharingDraft;
	organizationName?: string;
}): Record<SpaceLinkJoining, string> {
	const labels = Object.fromEntries(
		(["invite_only", "anyone", "password"] as const).map((joining) => [
			joining,
			describeSpaceJoining({
				draft: setSpaceLinkJoining(input.draft, joining),
				organizationName: input.organizationName,
			}).label,
		])
	) as Record<SpaceLinkJoining, string>;
	if (labels.anyone === labels.password) {
		labels.anyone = `${labels.anyone} — open link joining`;
		labels.password = `${labels.password} — password-protected link joining`;
	}
	return labels;
}

function describeReading(
	reading: SpaceLinkReading,
	draft: SpaceSharingDraft,
	organizationName?: string
): string {
	if (reading === "restricted") {
		return draft.visibility === "public" && organizationName
			? `People at ${organizationName} can join to read.`
			: "Invite people to join before they can read.";
	}
	if (reading === "password") {
		return "Visitors enter the password to read. No sign-in required.";
	}
	return "No sign-in required.";
}

function resolveReadingIcon(reading: SpaceLinkReading) {
	if (reading === "restricted") {
		return LockKeyIcon;
	}
	if (reading === "password") {
		return PasswordIcon;
	}
	return UsersIcon;
}
