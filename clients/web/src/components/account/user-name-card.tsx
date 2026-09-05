import {
	ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
	accountDisplayNameSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { SettingsFieldStatusBadge } from "@openmeld/ui/components/settings-field";
import type { SettingsFieldStatus } from "@openmeld/ui/lib/settings-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { useEffect, useMemo, useState } from "react";
import { useAccountSession, useUpdateUserName } from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";
import { UserNameCardSkeleton } from "./account-skeletons";

export function UserNameCard() {
	const { data: currentSession, isPending: isSessionPending } =
		useAccountSession();
	const updateName = useUpdateUserName();

	const user = currentSession?.user;
	const [name, setName] = useState(user?.name ?? "");
	const [hasSaved, setHasSaved] = useState(false);
	const [hasInteracted, setHasInteracted] = useState(false);
	const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);

	useEffect(() => {
		setName(user?.name ?? "");
		setHasSaved(false);
		setHasInteracted(false);
		setHasAttemptedSubmit(false);
	}, [user?.name]);

	const validation = useMemo(
		() => accountDisplayNameSchema.safeParse(name),
		[name]
	);
	const validationError = validation.success
		? null
		: (validation.error.issues[0]?.message ?? "Invalid display name");
	const shouldShowValidationError = hasInteracted || hasAttemptedSubmit;
	const visibleValidationError = shouldShowValidationError
		? validationError
		: null;

	if (isSessionPending) {
		return <UserNameCardSkeleton />;
	}

	if (!user) {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Display Name</CardTitle>
					<CardDescription>No user data available.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const isDirty = name.trim() !== (user.name ?? "").trim();
	const isSubmitDisabled =
		updateName.isPending || !isDirty || Boolean(validationError);

	// Map the paired Account/default-Human-Profile mutation plus local form state
	// onto the shared settings field lifecycle.
	const status = resolveDisplayNameStatus({
		isSaving: updateName.isPending,
		isError: updateName.isError || Boolean(visibleValidationError),
		hasSaved,
		isDirty,
	});
	const errorCopy =
		status === "error"
			? (visibleValidationError ??
				(updateName.error
					? getAuthErrorMessage(
							updateName.error,
							"Failed to update display name."
						)
					: null))
			: null;

	async function handleSave() {
		if (!validation.success) {
			setHasAttemptedSubmit(true);
			setHasSaved(false);
			return;
		}

		setHasAttemptedSubmit(false);
		try {
			await updateName.mutateAsync(validation.data);
			setHasSaved(true);
		} catch {
			setHasSaved(false);
		}
	}

	const handleSaveClick = () => {
		handleSave().catch(() => {
			setHasSaved(false);
		});
	};

	return (
		<Card className="h-full">
			<CardHeader>
				<CardTitle>Display Name</CardTitle>
				<CardDescription>
					Please enter your full name, or a display name you are comfortable
					with. This also names your default profile. Up to{" "}
					{ACCOUNT_DISPLAY_NAME_MAX_LENGTH} characters.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex w-full items-center gap-2">
					<Input
						aria-invalid={toAriaInvalid(visibleValidationError)}
						aria-label="Display Name"
						className={cn(
							"min-w-0 flex-1",
							visibleValidationError && "border-destructive"
						)}
						disabled={updateName.isPending}
						id="account-display-name"
						maxLength={ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
						onChange={(event) => {
							setHasInteracted(true);
							setHasSaved(false);
							setName(event.target.value);
						}}
						placeholder="Enter your display name"
						value={name}
					/>
					<span className="shrink-0 text-muted-foreground text-xs tabular-nums">
						{name.length}/{ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
					</span>
				</div>
			</CardContent>
			<CardFooter className="mt-auto flex-wrap justify-between gap-3">
				<div className="min-w-0">
					{errorCopy ? (
						<p className="text-destructive text-xs" role="alert">
							{errorCopy}
						</p>
					) : (
						<SettingsFieldStatusBadge status={status} />
					)}
				</div>
				<Button disabled={isSubmitDisabled} onClick={handleSaveClick} size="sm">
					{updateName.isPending ? "Saving..." : "Save"}
				</Button>
			</CardFooter>
		</Card>
	);
}

/**
 * Project the existing mutation + form state onto the settings field lifecycle.
 * Precedence: error → saving → saved → dirty → idle.
 */
function resolveDisplayNameStatus(input: {
	isSaving: boolean;
	isError: boolean;
	hasSaved: boolean;
	isDirty: boolean;
}): SettingsFieldStatus {
	if (input.isError) {
		return "error";
	}
	if (input.isSaving) {
		return "saving";
	}
	if (input.hasSaved && !input.isDirty) {
		return "saved";
	}
	if (input.isDirty) {
		return "dirty";
	}
	return "idle";
}
