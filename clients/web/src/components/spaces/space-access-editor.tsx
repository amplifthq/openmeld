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
	restricted: "Only people with access",
	anyone: "Anyone with the link",
	password: "Anyone with the password",
};

const JOINING_LABELS: Record<SpaceLinkJoining, string> = {
	invite_only: "By invitation",
	anyone: "Sign in to join",
	password: "Password required",
};

// The editor renders the deliberately different Share and Access disclosures from one policy draft.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: access combinations remain explicit so their user-facing meaning stays reviewable.
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
	const [isChangingJoining, setIsChangingJoining] = useState(false);
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
	const isShare = input.surface === "share";

	return (
		<div className="min-w-0 space-y-4">
			<section className="grid gap-2">
				<div className="space-y-0.5">
					<h3 className="font-medium text-sm">Link access</h3>
					{isShare ? null : (
						<p className="text-muted-foreground text-xs/relaxed">
							Choose who can read this Space from its link.
						</p>
					)}
				</div>
				<ReadingSelect
					disabled={input.disabled || !input.canManageAccess}
					onChange={(value) => {
						input.onDraftChange(setSpaceLinkReading(input.draft, value));
						setIsChangingPassword(false);
						if (value === "restricted") {
							setIsChangingJoining(false);
						}
					}}
					value={reading}
				/>
				<p className="text-muted-foreground text-xs/relaxed">
					{describeReading(reading)}
				</p>

				{selectedModeNeedsPassword &&
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
								variant="ghost"
							>
								Change password
							</Button>
						) : null}
					</div>
				) : null}

				{showPasswordInput ? (
					<label className="block space-y-1" htmlFor={passwordInputId}>
						<span className="font-medium text-xs">
							{reading === "anyone" && joining === "password"
								? "Password to join"
								: "Password to view"}
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
							{describePasswordUse(reading, joining)}
						</span>
					</label>
				) : null}
			</section>

			{reading === "restricted" ? (
				<div className="space-y-3">
					<p className="text-sm">
						This link only works for people who already have access.
					</p>
					{isShare && input.onInvitePeople ? (
						<InvitePeopleButton onClick={input.onInvitePeople} />
					) : null}
				</div>
			) : (
				<section
					className={
						isShare ? "grid gap-2" : "grid gap-2 border-border/60 border-t pt-4"
					}
				>
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0 space-y-0.5">
							{isShare ? null : (
								<h3 className="font-medium text-sm">Participation</h3>
							)}
							<p className={isShare ? "text-sm" : "font-medium text-xs"}>
								{describeJoining(joining, input.draft, input.organizationName)}
							</p>
						</div>
						{isShare && input.canManageAccess ? (
							<Button
								disabled={input.disabled}
								onClick={() => setIsChangingJoining((value) => !value)}
								size="xs"
								type="button"
								variant="ghost"
							>
								{isChangingJoining ? "Done" : "Change"}
							</Button>
						) : null}
					</div>
					{!isShare || isChangingJoining ? (
						<div className="grid gap-2 rounded-md border border-border/70 p-3">
							<label
								className="font-medium text-xs"
								htmlFor={`${passwordInputId}-join`}
							>
								Joining from this link
							</label>
							<JoiningSelect
								disabled={input.disabled || !input.canManageAccess}
								id={`${passwordInputId}-join`}
								onChange={(value) => {
									input.onDraftChange(setSpaceLinkJoining(input.draft, value));
									setIsChangingPassword(false);
								}}
								reading={reading}
								value={joining}
							/>
							{joining === "password" && reading === "anyone" ? (
								<p className="text-muted-foreground text-xs/relaxed">
									The Space password is required to join, but not to read.
								</p>
							) : null}
						</div>
					) : null}
					{isShare && input.onInvitePeople ? (
						<InvitePeopleButton onClick={input.onInvitePeople} />
					) : null}
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

function InvitePeopleButton({ onClick }: { onClick: () => void }) {
	return (
		<Button
			className="w-fit"
			onClick={onClick}
			size="sm"
			type="button"
			variant="ghost"
		>
			Invite people…
		</Button>
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
				aria-label="Link access"
				className="w-full"
				displayValue={READING_LABELS[input.value]}
				icon={resolveReadingIcon(input.value)}
			/>
			<SelectContent matchTriggerWidth>
				<SelectItem icon={LockKeyIcon} index={0} value="restricted">
					Only people with access
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
	id: string;
	onChange: (value: SpaceLinkJoining) => void;
	reading: SpaceLinkReading;
	value: SpaceLinkJoining;
}) {
	return (
		<Select
			disabled={input.disabled}
			onValueChange={(value) => input.onChange(value as SpaceLinkJoining)}
			value={input.value}
		>
			<SelectTrigger
				aria-label="Joining from this link"
				className="w-full"
				displayValue={JOINING_LABELS[input.value]}
				id={input.id}
			/>
			<SelectContent matchTriggerWidth>
				<SelectItem index={0} value="invite_only">
					By invitation
				</SelectItem>
				{input.reading === "anyone" ? (
					<SelectItem index={1} value="anyone">
						Sign in to join
					</SelectItem>
				) : null}
				<SelectItem index={2} value="password">
					Password required
				</SelectItem>
			</SelectContent>
		</Select>
	);
}

function describeReading(reading: SpaceLinkReading): string {
	if (reading === "restricted") {
		return "This link does not grant access.";
	}
	if (reading === "password") {
		return "Visitors need the Space password to read.";
	}
	return "Anyone can read without signing in.";
}

function describePasswordUse(
	reading: SpaceLinkReading,
	joining: SpaceLinkJoining
): string {
	if (reading === "anyone" && joining === "password") {
		return "People need this password to join. Reading stays public.";
	}
	if (joining === "password") {
		return "Visitors need this password to read and join the Space.";
	}
	return "Visitors need this password to read the Space. Joining remains by invitation.";
}

function describeJoining(
	joining: SpaceLinkJoining,
	draft: SpaceSharingDraft,
	organizationName?: string
): string {
	const exception =
		draft.visibility === "public" && organizationName
			? ` People at ${organizationName} can also find and join this Space.`
			: "";
	if (joining === "invite_only") {
		return `Joining is by invitation.${exception}`;
	}
	if (joining === "password") {
		return `A password is required to join.${exception}`;
	}
	if (!draft.allowGuests) {
		return `People at ${organizationName ?? "your organization"} can sign in to join. Guests need an invitation.`;
	}
	return "Anyone can sign in to join.";
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
