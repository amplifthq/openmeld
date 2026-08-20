"use client";

import {
	ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
	accountDisplayNameSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { cn } from "@openmeld/ui/lib/utils";
import { type FormEvent, useMemo, useState } from "react";
import { useUpdateUserName } from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";

export function HumanProfileNameEditor(input: {
	onCancel: () => void;
	onSaved: () => void;
	profileName: string;
}) {
	const updateName = useUpdateUserName();
	const [draftName, setDraftName] = useState<string | null>(null);
	const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
	const name = draftName ?? input.profileName;
	const validation = useMemo(
		() => accountDisplayNameSchema.safeParse(name),
		[name]
	);
	const validationError = validation.success
		? null
		: (validation.error.issues[0]?.message ?? "Invalid display name");
	let visibleError = hasAttemptedSubmit ? validationError : null;
	if (!visibleError && updateName.error) {
		visibleError = getAuthErrorMessage(
			updateName.error,
			"OpenMeld could not update this Human Profile."
		);
	}
	const normalizedCurrentName = input.profileName.trim();
	const normalizedName = name.trim();
	const saveDisabled =
		updateName.isPending ||
		Boolean(validationError) ||
		normalizedName === normalizedCurrentName;

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setHasAttemptedSubmit(true);
		if (!validation.success || saveDisabled) {
			return;
		}
		updateName.mutate(validation.data, { onSuccess: input.onSaved });
	};

	return (
		<form aria-label="Edit Human Profile" onSubmit={handleSubmit}>
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="human-profile-name">Name</Label>
				<span className="text-muted-foreground text-xs tabular-nums">
					{name.length}/{ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
				</span>
			</div>
			<Input
				aria-invalid={toAriaInvalid(visibleError)}
				autoFocus
				className={cn("mt-2", visibleError && "border-destructive")}
				disabled={updateName.isPending}
				id="human-profile-name"
				maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
				onChange={(event) => {
					setHasAttemptedSubmit(false);
					updateName.reset();
					setDraftName(event.target.value);
				}}
				value={name}
			/>
			{visibleError ? (
				<p className="mt-2 text-destructive text-xs" role="alert">
					{visibleError}
				</p>
			) : null}
			<div className="mt-3 flex justify-end gap-2">
				<Button
					disabled={updateName.isPending}
					onClick={input.onCancel}
					size="sm"
					type="button"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button disabled={saveDisabled} size="sm" type="submit">
					{updateName.isPending ? "Saving…" : "Save changes"}
				</Button>
			</div>
		</form>
	);
}
