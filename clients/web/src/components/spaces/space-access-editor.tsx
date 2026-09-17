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
	restricted: "Restricted",
	anyone: "Anyone with the link",
	password: "Anyone with the password",
};

const JOINING_LABELS: Record<SpaceLinkJoining, string> = {
	invite_only: "Invitation only",
	anyone: "Anyone with the link",
	password: "Password required",
};

// The branches mirror the three explicit product dimensions in one compact editor.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keeping the mutually dependent controls together makes their state relationship visible.
export function SpaceAccessEditor(input: {
	allowGuests?: boolean;
	canManageAccess: boolean;
	currentAccessMode: SpaceAccessMode;
	disabled: boolean;
	draft: SpaceSharingDraft;
	errorMessage: string | null;
	organizationSection?: ReactNode;
	onDraftChange: (draft: SpaceSharingDraft) => void;
	onPasswordChange: (password: string) => void;
	password: string;
}) {
	const passwordInputId = useId();
	const [showParticipationControls, setShowParticipationControls] =
		useState(false);
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
					<h3 className="font-medium text-sm">Link access</h3>
					<p className="text-muted-foreground text-xs/relaxed">
						Controls who can read this Space from its link. Reading never joins
						the Space.
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
							aria-label="Link access"
							className="w-full"
							displayValue={READING_LABELS[reading]}
							icon={resolveReadingIcon(reading)}
						/>
						<SelectContent matchTriggerWidth>
							<SelectItem icon={LockKeyIcon} index={0} value="restricted">
								Restricted
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
								variant="ghost"
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
			</section>
			{input.organizationSection}

			<section className="space-y-2 border-border/60 border-t pt-4">
				<div className="flex items-start justify-between gap-3">
					<div className="space-y-0.5">
						<h3 className="font-medium text-sm">Participation</h3>
						<p className="text-muted-foreground text-xs/relaxed">
							{describeParticipation(reading, joining, input.allowGuests)}
						</p>
					</div>
					{input.canManageAccess && reading !== "restricted" ? (
						<Button
							disabled={input.disabled}
							onClick={() => setShowParticipationControls((value) => !value)}
							size="xs"
							type="button"
							variant="ghost"
						>
							{showParticipationControls ? "Done" : "Change"}
						</Button>
					) : null}
				</div>
				{showParticipationControls && reading !== "restricted" ? (
					<div className="grid gap-1">
						<label
							className="text-muted-foreground text-xs"
							htmlFor={`${passwordInputId}-join`}
						>
							Join from link
						</label>
						<Select
							disabled={input.disabled}
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
								aria-label="Join from link"
								className="w-full"
								displayValue={JOINING_LABELS[joining]}
								id={`${passwordInputId}-join`}
							/>
							<SelectContent matchTriggerWidth>
								<SelectItem index={0} value="invite_only">
									Invitation only
								</SelectItem>
								{reading === "anyone" ? (
									<SelectItem index={1} value="anyone">
										Anyone with the link
									</SelectItem>
								) : null}
								<SelectItem index={2} value="password">
									Password required
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				) : null}
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

function describeParticipation(
	reading: SpaceLinkReading,
	joining: SpaceLinkJoining,
	allowGuests?: boolean
): string {
	if (reading === "restricted") {
		return "Only people who are added or invited can participate.";
	}
	if (joining === "invite_only") {
		return "People can read from the link, but only invited people can join.";
	}
	if (joining === "password") {
		return "People need the Space password to join from the link.";
	}
	if (allowGuests === false) {
		return "Link joining is enabled, but external guests are currently blocked.";
	}
	return "People can join from the link when guest access allows it.";
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
