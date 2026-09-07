import { Button } from "@openmeld/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Surface } from "@openmeld/ui/fluid/surface";
import { cn } from "@openmeld/ui/lib/utils";
import { EyeIcon, EyeSlashIcon, KeyIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
	useAccountSession,
	useChangePassword,
	useHasPassword,
	useSetPassword,
} from "#/hooks/account.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { PasswordChangeCardSkeleton } from "./account-skeletons";

const MIN_PASSWORD_LENGTH = 8;

type PasswordFormState = {
	current: string;
	next: string;
	confirm: string;
};

const INITIAL_PASSWORDS: PasswordFormState = {
	current: "",
	next: "",
	confirm: "",
};

function PasswordField({
	id,
	label,
	placeholder,
	value,
	disabled,
	onChange,
}: {
	id: string;
	label: string;
	placeholder: string;
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
}) {
	const [visible, setVisible] = useState(false);

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<div className="relative">
				<Input
					disabled={disabled}
					id={id}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					type={visible ? "text" : "password"}
					value={value}
				/>
				<Button
					className="absolute top-0 right-0 h-full"
					disabled={disabled}
					onClick={() => setVisible((current) => !current)}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					{visible ? (
						<EyeSlashIcon className="size-3.5" />
					) : (
						<EyeIcon className="size-3.5" />
					)}
				</Button>
			</div>
		</div>
	);
}

function passwordButtonLabel(isPending: boolean, hasPassword: boolean): string {
	if (isPending) {
		return "Saving...";
	}

	if (hasPassword) {
		return "Change Password";
	}

	return "Set Password";
}

function summaryTitle(hasPassword: boolean): string {
	return hasPassword ? "Change Password" : "Set Password";
}

function summaryDescription(hasPassword: boolean): string {
	if (hasPassword) {
		return "Update your existing password.";
	}

	return "Enable email/password login for this account.";
}

export function PasswordChangeCard() {
	const { data: session, isPending: isSessionPending } = useAccountSession();
	const hasPassword = useHasPassword();
	const changePassword = useChangePassword();
	const setPassword = useSetPassword();

	const [isFormOpen, setIsFormOpen] = useState(false);
	const [passwords, setPasswords] =
		useState<PasswordFormState>(INITIAL_PASSWORDS);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);

	if (isSessionPending) {
		return <PasswordChangeCardSkeleton />;
	}

	if (!session?.user) {
		return (
			<Card id="password-card">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<KeyIcon className="size-5" />
						Password Security
					</CardTitle>
					<CardDescription>No user data available.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const isPending = changePassword.isPending || setPassword.isPending;
	const hasMinimumLength = passwords.next.length >= MIN_PASSWORD_LENGTH;
	const passwordsMatch =
		passwords.next.length > 0 && passwords.next === passwords.confirm;
	const canSubmit = hasPassword
		? Boolean(passwords.current) && hasMinimumLength && passwordsMatch
		: hasMinimumLength && passwordsMatch;

	const resetFormState = () => {
		setPasswords(INITIAL_PASSWORDS);
		setIsFormOpen(false);
	};

	async function handleSubmit() {
		setStatusMessage(null);

		if (!canSubmit) {
			setStatusMessage(
				`Password must be at least ${String(MIN_PASSWORD_LENGTH)} characters and both password fields must match.`
			);
			return;
		}

		try {
			if (hasPassword) {
				await changePassword.mutateAsync({
					currentPassword: passwords.current,
					newPassword: passwords.next,
					revokeOtherSessions: false,
				});
			} else {
				await setPassword.mutateAsync(passwords.next);
			}
			setStatusMessage(hasPassword ? "Password updated." : "Password set.");
			resetFormState();
		} catch (error) {
			setStatusMessage(
				getAuthErrorMessage(error, "Failed to update password.")
			);
		}
	}

	const handleSubmitClick = () => {
		handleSubmit().catch(() => {
			setStatusMessage("Failed to update password.");
		});
	};

	const handleCancel = () => {
		setStatusMessage(null);
		resetFormState();
	};

	return (
		<Card
			className={cn(
				"transition-colors",
				"target:ring-1 target:ring-ring/50",
				isFormOpen && "ring-1 ring-ring/50"
			)}
			id="password-card"
		>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<KeyIcon className="size-5" />
					Password Security
				</CardTitle>
				<CardDescription>
					Manage your password and account security settings.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{isFormOpen ? (
					<Surface className="space-y-4 p-3">
						{hasPassword ? (
							<PasswordField
								disabled={isPending}
								id="current-password"
								label="Current Password"
								onChange={(value) =>
									setPasswords((state) => ({ ...state, current: value }))
								}
								placeholder="Enter current password"
								value={passwords.current}
							/>
						) : null}

						<PasswordField
							disabled={isPending}
							id="new-password"
							label={hasPassword ? "New Password" : "Password"}
							onChange={(value) =>
								setPasswords((state) => ({ ...state, next: value }))
							}
							placeholder="At least 8 characters"
							value={passwords.next}
						/>

						<PasswordField
							disabled={isPending}
							id="confirm-password"
							label="Confirm Password"
							onChange={(value) =>
								setPasswords((state) => ({ ...state, confirm: value }))
							}
							placeholder="Re-enter password"
							value={passwords.confirm}
						/>

						<div className="flex justify-end gap-2">
							<Button
								disabled={isPending}
								onClick={handleCancel}
								size="sm"
								variant="outline"
							>
								Cancel
							</Button>
							<Button
								disabled={!canSubmit || isPending}
								onClick={handleSubmitClick}
								size="sm"
							>
								{passwordButtonLabel(isPending, hasPassword)}
							</Button>
						</div>
					</Surface>
				) : (
					<Surface className="flex items-center justify-between gap-3 p-3">
						<div>
							<p className="font-medium text-sm">{summaryTitle(hasPassword)}</p>
							<p className="text-muted-foreground text-xs">
								{summaryDescription(hasPassword)}
							</p>
						</div>
						<Button
							disabled={isPending}
							onClick={() => setIsFormOpen(true)}
							size="sm"
							variant="outline"
						>
							{hasPassword ? "Change" : "Set"}
						</Button>
					</Surface>
				)}

				{statusMessage ? (
					<p className="text-muted-foreground text-xs">{statusMessage}</p>
				) : null}
				<p className="text-muted-foreground text-xs">
					Password requirement: at least {String(MIN_PASSWORD_LENGTH)}{" "}
					characters.
				</p>
			</CardContent>
		</Card>
	);
}
