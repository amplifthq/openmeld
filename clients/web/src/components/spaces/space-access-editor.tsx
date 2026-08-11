"use client";

import {
	normalizeSpacePasswordText,
	spaceAccessModeUsesPassword,
} from "@openmeld/schemas";
import type { SpaceAccessMode } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { cn } from "@openmeld/ui/lib/utils";
import { WarningIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";

export type SpaceAccessUpdateInput = {
	accessMode: SpaceAccessMode;
	password?: string;
};

export const PUBLIC_SPACE_ACCESS_JOIN_WARNING =
	"Anyone with the Space ID can join.";
export const PUBLIC_SPACE_ACCESS_DESCRIPTION = `No password. ${PUBLIC_SPACE_ACCESS_JOIN_WARNING}`;
export const PUBLIC_SPACE_ACCESS_WARNING_TOOLTIP =
	"This Space is public. Anyone with the Space ID can view and join.";

const SPACE_ACCESS_WARNING_TEXT_CLASS_NAME =
	"text-amber-600 dark:text-amber-400";

export const SPACE_ACCESS_OPTIONS: readonly {
	description: string;
	label: string;
	labelClassName?: string;
	value: SpaceAccessMode;
}[] = [
	{
		description: "Only current members can view and participate.",
		label: "Members only",
		value: "members_only",
	},
	{
		description: PUBLIC_SPACE_ACCESS_DESCRIPTION,
		label: "Anyone can view and join",
		labelClassName: SPACE_ACCESS_WARNING_TEXT_CLASS_NAME,
		value: "public",
	},
	{
		description: "Password to join.",
		label: "Anyone can view, password to join",
		value: "public_view_join_password",
	},
	{
		description: "Password to view and join.",
		label: "Password protected",
		value: "protected",
	},
];

export function SpaceAccessModeRadioGroup(input: {
	disabled: boolean;
	onChange: (accessMode: SpaceAccessMode) => void;
	value: SpaceAccessMode;
}) {
	const selectedIndex = SPACE_ACCESS_OPTIONS.findIndex(
		(option) => option.value === input.value
	);

	return (
		<RadioGroup
			aria-disabled={input.disabled || undefined}
			aria-label="Space access"
			className={cn(
				"w-full gap-1",
				input.disabled && "pointer-events-none opacity-70"
			)}
			selectedIndex={selectedIndex}
		>
			{SPACE_ACCESS_OPTIONS.map((option, index) => {
				const isPublicAccessOption = option.value === "public";
				const isSelected = input.value === option.value;
				const shouldShowPublicAccessWarning =
					isPublicAccessOption && isSelected;
				return (
					<RadioItem
						className="px-3 py-2.5"
						cornerAdornment={
							isPublicAccessOption ? (
								<WarningIcon
									aria-hidden="true"
									className={cn(
										"size-3.5",
										shouldShowPublicAccessWarning
											? SPACE_ACCESS_WARNING_TEXT_CLASS_NAME
											: "text-muted-foreground"
									)}
								/>
							) : undefined
						}
						description={option.description}
						index={index}
						key={option.value}
						label={option.label}
						labelClassName={
							shouldShowPublicAccessWarning ? option.labelClassName : undefined
						}
						onSelect={() => {
							if (input.disabled) {
								return;
							}
							input.onChange(option.value);
						}}
						selected={isSelected}
					/>
				);
			})}
		</RadioGroup>
	);
}

export function SpaceAccessEditor(input: {
	accessMode: SpaceAccessMode;
	canManageAccess: boolean;
	className?: string;
	errorMessage: string | null;
	isPending: boolean;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
	readOnlyNote?: string;
}) {
	return (
		<div className={cn("min-w-0 space-y-4", input.className)}>
			<SpaceAccessSummary accessMode={input.accessMode} />

			{input.canManageAccess ? (
				<SpaceAccessControls
					accessMode={input.accessMode}
					errorMessage={input.errorMessage}
					isPending={input.isPending}
					onSetAccessMode={input.onSetAccessMode}
				/>
			) : (
				<p className="text-muted-foreground text-xs/relaxed">
					{input.readOnlyNote ?? "Only the Space owner can change this."}
				</p>
			)}
		</div>
	);
}

function SpaceAccessSummary(input: { accessMode: SpaceAccessMode }) {
	return (
		<div className="space-y-1">
			<p className="font-medium text-sm">
				{resolveSpaceAccessTitle(input.accessMode)}
			</p>
			<p className="text-muted-foreground text-xs/relaxed">
				{resolveSpaceAccessDescription(input.accessMode)}
			</p>
		</div>
	);
}

function SpaceAccessControls(input: {
	accessMode: SpaceAccessMode;
	errorMessage: string | null;
	isPending: boolean;
	onSetAccessMode: (input: SpaceAccessUpdateInput) => Promise<void>;
}) {
	const passwordInputId = useId();
	const [draftAccessMode, setDraftAccessMode] =
		useState<SpaceAccessMode | null>(null);
	const [password, setPassword] = useState("");
	const [isChangingPassword, setIsChangingPassword] = useState(false);
	const [localErrorMessage, setLocalErrorMessage] = useState<string | null>(
		null
	);
	const [
		isRemovePasswordConfirmationOpen,
		setIsRemovePasswordConfirmationOpen,
	] = useState(false);

	const selectedAccessMode = draftAccessMode ?? input.accessMode;
	const normalizedPassword = normalizeSpacePasswordText(password);
	const selectedModeNeedsPassword =
		spaceAccessModeUsesPassword(selectedAccessMode);
	const currentModeHasPassword = spaceAccessModeUsesPassword(input.accessMode);
	const mustSetPassword = selectedModeNeedsPassword && !currentModeHasPassword;
	const hasModeChange = selectedAccessMode !== input.accessMode;
	const hasPasswordChange =
		selectedModeNeedsPassword && normalizedPassword.length > 0;
	const removesExistingPassword =
		currentModeHasPassword && !selectedModeNeedsPassword;
	const showPasswordInput =
		selectedModeNeedsPassword &&
		(!currentModeHasPassword || isChangingPassword);
	const showCurrentPasswordReuse =
		selectedModeNeedsPassword && currentModeHasPassword && !isChangingPassword;
	const errorMessage = localErrorMessage ?? input.errorMessage;
	const saveDisabled =
		input.isPending ||
		!(hasModeChange || hasPasswordChange) ||
		(mustSetPassword && !hasPasswordChange);

	const saveAccess = async (inputOptions?: {
		confirmedPasswordRemoval?: boolean;
	}) => {
		if (saveDisabled) {
			return;
		}
		if (removesExistingPassword && !inputOptions?.confirmedPasswordRemoval) {
			setIsRemovePasswordConfirmationOpen(true);
			return;
		}
		if (mustSetPassword && !hasPasswordChange) {
			setLocalErrorMessage("Enter a Space password to use this access.");
			return;
		}
		setLocalErrorMessage(null);
		try {
			await input.onSetAccessMode({
				accessMode: selectedAccessMode,
				...(hasPasswordChange ? { password: normalizedPassword } : {}),
			});
			setIsRemovePasswordConfirmationOpen(false);
			setDraftAccessMode(null);
			setPassword("");
			setIsChangingPassword(false);
		} catch (error: unknown) {
			setLocalErrorMessage(
				error instanceof Error
					? error.message
					: "OpenMeld could not update sharing."
			);
		}
	};

	return (
		<>
			<div className="space-y-3">
				<SpaceAccessModeRadioGroup
					disabled={input.isPending}
					onChange={(accessMode) => {
						setDraftAccessMode(accessMode);
						setIsChangingPassword(false);
						setLocalErrorMessage(null);
					}}
					value={selectedAccessMode}
				/>

				{showCurrentPasswordReuse ? (
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<p className="text-muted-foreground text-xs">
							Using current Space password.
						</p>
						<Button
							disabled={input.isPending}
							onClick={() => {
								setIsChangingPassword(true);
								setLocalErrorMessage(null);
							}}
							size="xs"
							type="button"
							variant="ghost"
						>
							Change password
						</Button>
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
							disabled={input.isPending}
							id={passwordInputId}
							onChange={(event) => {
								setPassword(event.target.value);
								setLocalErrorMessage(null);
							}}
							type="password"
							value={password}
						/>
						<span className="block text-muted-foreground text-xs/relaxed">
							{currentModeHasPassword
								? "Leave blank to keep it."
								: "Sets the Space password."}
						</span>
					</label>
				) : null}

				{errorMessage ? (
					<p className="text-destructive text-xs" role="alert">
						{errorMessage}
					</p>
				) : null}

				<div className="flex justify-end">
					<Button
						disabled={saveDisabled}
						onClick={() => {
							saveAccess().catch((error) => {
								console.error("Failed to update Space access.", error);
							});
						}}
						size="sm"
						type="button"
					>
						{input.isPending ? "Saving..." : "Save access"}
					</Button>
				</div>
			</div>

			<Dialog
				onOpenChange={setIsRemovePasswordConfirmationOpen}
				open={isRemovePasswordConfirmationOpen}
			>
				<DialogContent className="bg-surface-1 sm:max-w-md">
					<DialogHeader className="pr-8">
						<DialogTitle>Remove the Space password?</DialogTitle>
						<DialogDescription>
							{selectedAccessMode === "members_only"
								? "Only current members will be able to open this Space. The Space password will be removed."
								: "Anyone with the link can view and join. The Space password will be removed."}
						</DialogDescription>
					</DialogHeader>
					<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
						<Button
							disabled={input.isPending}
							onClick={() => {
								setIsRemovePasswordConfirmationOpen(false);
							}}
							type="button"
							variant="outline"
						>
							Keep password
						</Button>
						<Button
							disabled={input.isPending}
							onClick={() => {
								saveAccess({ confirmedPasswordRemoval: true }).catch(
									(error) => {
										console.error("Failed to update Space access.", error);
									}
								);
							}}
							type="button"
							variant="destructive"
						>
							Remove password
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}

export function resolveSpaceAccessTitle(accessMode: SpaceAccessMode): string {
	switch (accessMode) {
		case "members_only":
			return "Members only";
		case "protected":
			return "Password protected";
		case "public_view_join_password":
			return "Anyone can view";
		default:
			return "Anyone can view and join";
	}
}

export function resolveSpaceAccessDescription(
	accessMode: SpaceAccessMode
): string {
	switch (accessMode) {
		case "members_only":
			return "Only current members can view and participate.";
		case "protected":
			return "Password to view and join.";
		case "public_view_join_password":
			return "Password to join.";
		default:
			return "No password.";
	}
}
