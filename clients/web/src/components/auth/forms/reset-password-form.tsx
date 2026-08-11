import { Label } from "@openmeld/ui/components/label";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";
import { ClientAuthForm } from "#/components/auth/forms/client-auth-form";
import { PasswordInput } from "#/components/auth/password-input";
import { SpinnerButton } from "#/components/spinner-button";
import { useResetPassword } from "#/hooks/auth-form.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";

type ResetPasswordFormProps = {
	className?: string;
};

const resetPasswordSchema = z
	.strictObject({
		newPassword: z.string().min(8, { message: "Password is too short" }),
		confirmPassword: z.string().min(8, { message: "Password is too short" }),
	})
	.refine((data) => data.newPassword === data.confirmPassword, {
		message: "Passwords do not match",
		path: ["confirmPassword"],
	});

type ResetPasswordFieldErrors = {
	newPassword?: string;
	confirmPassword?: string;
};

export function ResetPasswordForm({ className }: ResetPasswordFormProps) {
	const resetPassword = useResetPassword();
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [fieldErrors, setFieldErrors] = useState<ResetPasswordFieldErrors>({});

	const token = useMemo(() => {
		if (typeof window === "undefined") {
			return "";
		}
		return new URLSearchParams(window.location.search).get("token") ?? "";
	}, []);

	const submitResetPassword = async () => {
		if (!token || token === "INVALID_TOKEN") {
			toast.error("Invalid token");
			window.location.assign("/login");
			return;
		}

		const parseResult = resetPasswordSchema.safeParse({
			newPassword,
			confirmPassword,
		});
		if (!parseResult.success) {
			const errors = parseResult.error.flatten().fieldErrors;
			setFieldErrors({
				newPassword: errors.newPassword?.[0],
				confirmPassword: errors.confirmPassword?.[0],
			});
			return;
		}
		setFieldErrors({});

		try {
			await resetPassword.mutateAsync({
				newPassword: parseResult.data.newPassword,
				token,
			});
			toast.success("Password reset successfully");
			window.location.assign("/login");
		} catch (error) {
			toast.error(getAuthErrorMessage(error, "Failed to reset password."));
			setNewPassword("");
			setConfirmPassword("");
		}
	};

	return (
		<ClientAuthForm
			className={`grid w-full gap-6 ${className ?? ""}`}
			onSubmit={(event) => {
				event.preventDefault();
				submitResetPassword().catch((error) => {
					toast.error(getAuthErrorMessage(error, "Failed to reset password."));
					setNewPassword("");
					setConfirmPassword("");
				});
			}}
		>
			<div className="space-y-2">
				<Label>New Password</Label>
				<PasswordInput
					aria-invalid={toAriaInvalid(fieldErrors.newPassword)}
					autoComplete="new-password"
					disabled={resetPassword.isPending}
					onChange={(event) => {
						setNewPassword(event.target.value);
						if (fieldErrors.newPassword) {
							setFieldErrors((current) => ({
								...current,
								newPassword: undefined,
							}));
						}
					}}
					placeholder="New Password"
					value={newPassword}
				/>
				{fieldErrors.newPassword ? (
					<p className="text-destructive text-xs">{fieldErrors.newPassword}</p>
				) : null}
			</div>

			<div className="space-y-2">
				<Label>Confirm Password</Label>
				<PasswordInput
					aria-invalid={toAriaInvalid(fieldErrors.confirmPassword)}
					autoComplete="new-password"
					disabled={resetPassword.isPending}
					onChange={(event) => {
						setConfirmPassword(event.target.value);
						if (fieldErrors.confirmPassword) {
							setFieldErrors((current) => ({
								...current,
								confirmPassword: undefined,
							}));
						}
					}}
					placeholder="Confirm Password"
					value={confirmPassword}
				/>
				{fieldErrors.confirmPassword ? (
					<p className="text-destructive text-xs">
						{fieldErrors.confirmPassword}
					</p>
				) : null}
			</div>

			<SpinnerButton
				buttonState={resetPassword.isPending ? "loading" : "idle"}
				className="w-full text-md"
				disabled={resetPassword.isPending}
				isLoading={resetPassword.isPending}
				type="submit"
			>
				Reset Password
			</SpinnerButton>

			{token ? null : (
				<Link className="text-muted-foreground text-sm underline" to="/login">
					Back to login
				</Link>
			)}
		</ClientAuthForm>
	);
}
