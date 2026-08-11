"use client";

import {
	ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
	accountDisplayNameSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { cn } from "@openmeld/ui/lib/utils";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useUpdateUserName } from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";

export function HumanProfileEditDialog(input: {
	onOpenChange: (open: boolean) => void;
	open: boolean;
	profileName: string;
}) {
	const updateName = useUpdateUserName();
	const [name, setName] = useState(input.profileName);
	const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
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

	useEffect(() => {
		if (!input.open) {
			return;
		}
		setName(input.profileName);
		setHasAttemptedSubmit(false);
		updateName.reset();
	}, [input.open, input.profileName, updateName.reset]);

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setHasAttemptedSubmit(true);
		if (!validation.success || saveDisabled) {
			return;
		}
		updateName.mutate(validation.data, {
			onSuccess: () => input.onOpenChange(false),
		});
	};

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<form className="space-y-5" onSubmit={handleSubmit}>
					<DialogHeader>
						<DialogTitle>Edit Human Profile</DialogTitle>
						<DialogDescription>
							Update your display name across OpenMeld. This also updates your
							default Human Profile.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-2">
						<div className="flex items-center justify-between gap-3">
							<Label htmlFor="human-profile-name">Name</Label>
							<span className="text-muted-foreground text-xs tabular-nums">
								{name.length}/{ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
							</span>
						</div>
						<Input
							aria-invalid={toAriaInvalid(visibleError)}
							className={cn(visibleError && "border-destructive")}
							disabled={updateName.isPending}
							id="human-profile-name"
							maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
							onChange={(event) => {
								setHasAttemptedSubmit(false);
								updateName.reset();
								setName(event.target.value);
							}}
							value={name}
						/>
						{visibleError ? (
							<p className="text-destructive text-xs" role="alert">
								{visibleError}
							</p>
						) : null}
					</div>

					<DialogFooter>
						<Button
							disabled={updateName.isPending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={saveDisabled} type="submit">
							{updateName.isPending ? "Saving…" : "Save changes"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
