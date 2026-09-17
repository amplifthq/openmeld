"use client";

import {
	normalizeSpacePasswordText,
	spaceAccessModeUsesPassword,
} from "@openmeld/schemas";
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
import { type ReactNode, useId, useState } from "react";
import {
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
	linkJoinPolicy?: SpaceLinkJoinPolicy;
	password?: string;
};

export const PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP =
	"Anyone with the link can read this Space, including people outside your organization.";

const READING_LABELS: Record<SpaceLinkReading, string> = {
	restricted: "Only invited people",
	anyone: "Anyone with the link",
	password: "Anyone with the password",
};

const JOINING_LABELS: Record<SpaceLinkJoining, string> = {
	invite_only: "Only invited people",
	anyone: "Anyone with the link",
	password: "Anyone with the password",
};

export function SpaceAccessEditor(input: {
	actionVariant?: "ghost" | "secondary";
	allowGuests?: boolean;
	canManageAccess: boolean;
	currentAccessMode: SpaceAccessMode;
	disabled: boolean;
	draft: SpaceSharingDraft;
	errorMessage: string | null;
	linkSectionFooter?: ReactNode;
	organizationSection?: ReactNode;
	onDraftChange: (draft: SpaceSharingDraft) => void;
	onPasswordChange: (password: string) => void;
	password: string;
}) {
	const passwordInputId = useId();
	const actionVariant = input.actionVariant ?? "ghost";
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const reading = resolveSpaceLinkReading(input.draft);
	const joining = resolveSpaceLinkJoining(input.draft);
	const currentModeHasPassword = spaceAccessModeUsesPassword(
		input.currentAccessMode
	);
	const selectedModeNeedsPassword = spaceAccessModeUsesPassword(
		input.draft.accessMode
	);
	const showPasswordInput =
		selectedModeNeedsPassword &&
		(!currentModeHasPassword || isChangingPassword);
	const password = normalizeSpacePasswordText(input.password);

	return (
		<div className="min-w-0 space-y-4">
			<section className="grid gap-2">
				<div className="space-y-0.5">
					<h3 className="font-medium text-sm">Who can access</h3>
					<p className="text-muted-foreground text-xs/relaxed">
						Choose who can open this Space from the shared link.
					</p>
				</div>
				{input.canManageAccess ? (
					<Select
						disabled={input.disabled}
						onValueChange={(value) => {
							if (
								value === "restricted" ||
								value === "anyone" ||
								value === "password"
							) {
								input.onDraftChange(setSpaceLinkReading(input.draft, value));
								setIsChangingPassword(false);
							}
						}}
						value={reading}
					>
						<SelectTrigger
							aria-label="Who can access"
							className="w-full"
							displayValue={READING_LABELS[reading]}
							icon={resolveReadingIcon(reading)}
						/>
						<SelectContent matchTriggerWidth>
							<SelectItem icon={LockKeyIcon} index={0} value="restricted">
								Only invited people
							</SelectItem>
							<SelectItem icon={UsersIcon} index={1} value="anyone">
								Anyone with the link
							</SelectItem>
							<SelectItem icon={PasswordIcon} index={2} value="password">
								Anyone with the password
							</SelectItem>
						</SelectContent>
					</Select>
				) : (
					<p className="text-sm">{READING_LABELS[reading]}</p>
				)}

				{selectedModeNeedsPassword &&
				currentModeHasPassword &&
				!showPasswordInput ? (
					<div className="flex items-center justify-between gap-3">
						<p className="text-muted-foreground text-xs">
							Using the current Space password.
						</p>
						{input.canManageAccess ? (
							<Button
								disabled={input.disabled}
								onClick={() => setIsChangingPassword(true)}
								size="xs"
								type="button"
								variant={actionVariant}
							>
								Change password
							</Button>
						) : null}
					</div>
				) : null}

				{showPasswordInput ? (
					<label className="block space-y-1" htmlFor={passwordInputId}>
						<span className="text-muted-foreground text-xs">
							{currentModeHasPassword
								? "New Space password"
								: "Set Space password"}
						</span>
						<Input
							autoComplete="new-password"
							disabled={input.disabled}
							id={passwordInputId}
							onChange={(event) => input.onPasswordChange(event.target.value)}
							type="password"
							value={input.password}
						/>
						<span className="block text-muted-foreground text-xs/relaxed">
							{currentModeHasPassword && password.length === 0
								? "Leave blank to keep the current password."
								: "People will enter this password before reading or joining."}
						</span>
					</label>
				) : null}
				{input.linkSectionFooter}
			</section>
			{input.organizationSection}

			<section className="grid gap-2 border-border/60 border-t pt-4">
				<div className="space-y-0.5">
					<h3 className="font-medium text-sm">Who can join</h3>
					<p className="text-muted-foreground text-xs/relaxed">
						People who join can post messages and use this Space’s Agents.
					</p>
				</div>
				{input.canManageAccess ? (
					<div className="grid gap-1">
						<Select
							disabled={input.disabled || reading === "restricted"}
							onValueChange={(value) => {
								if (
									value === "invite_only" ||
									value === "anyone" ||
									value === "password"
								) {
									input.onDraftChange(setSpaceLinkJoining(input.draft, value));
									setIsChangingPassword(false);
								}
							}}
							value={joining}
						>
							<SelectTrigger
								aria-label="Who can join"
								className="w-full"
								displayValue={JOINING_LABELS[joining]}
								id={`${passwordInputId}-join`}
							/>
							<SelectContent matchTriggerWidth>
								<SelectItem index={0} value="invite_only">
									Only invited people
								</SelectItem>
								{reading === "anyone" ? (
									<SelectItem index={1} value="anyone">
										Anyone with the link
									</SelectItem>
								) : null}
								<SelectItem index={2} value="password">
									Anyone with the password
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				) : (
					<p className="text-sm">{JOINING_LABELS[joining]}</p>
				)}
				<p className="rounded-md bg-muted/50 px-3 py-2 text-muted-foreground text-xs/relaxed">
					{describeLinkOutcome(reading, joining, input.allowGuests)}
				</p>
			</section>

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

function describeLinkOutcome(
	reading: SpaceLinkReading,
	joining: SpaceLinkJoining,
	allowGuests?: boolean
): string {
	if (reading === "restricted") {
		return "This link does not grant access. Only people who are added or invited can open the Space.";
	}
	if (reading === "password") {
		if (joining === "invite_only") {
			return "People with the Space password can read this Space. Only invited people can join, post messages, and use Agents.";
		}
		return "People need the Space password to read and join this Space, post messages, and use Agents.";
	}
	if (joining === "invite_only") {
		return "Anyone with the link can read this Space. Only invited people can join, post messages, and use Agents.";
	}
	if (joining === "password") {
		return "People with this link can read the Space. They need the Space password to join, post messages, and use Agents.";
	}
	if (allowGuests === false) {
		return "Organization members can join from this link. People outside the organization need a guest invitation.";
	}
	return "Anyone with this link can read and join the Space, post messages, and use Agents.";
}

function resolveReadingIcon(reading: SpaceLinkReading) {
	switch (reading) {
		case "restricted":
			return LockKeyIcon;
		case "password":
			return PasswordIcon;
		default:
			return UsersIcon;
	}
}
