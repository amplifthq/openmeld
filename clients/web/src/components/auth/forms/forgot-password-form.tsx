import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod/v4";
import { ClientAuthForm } from "#/components/auth/forms/client-auth-form";
import { SpinnerButton } from "#/components/spinner-button";
import { useRequestPasswordReset } from "#/hooks/auth-form.hooks";
import { getAuthErrorMessage } from "#/lib/auth-errors";
import { toAriaInvalid } from "#/lib/form-error";

type ForgotPasswordFormProps = {
	className?: string;
	isSubmitting?: boolean;
	setIsSubmitting?: (isSubmitting: boolean) => void;
};

const forgotPasswordSchema = z.strictObject({
	email: z
		.string()
		.min(1, { message: "Email is required" })
		.email({ message: "Email is invalid" }),
});

export function ForgotPasswordForm({
	className,
	isSubmitting = false,
	setIsSubmitting,
}: ForgotPasswordFormProps) {
	const requestReset = useRequestPasswordReset();
	const [email, setEmail] = useState("");
	const [emailError, setEmailError] = useState<string | null>(null);

	const pending = isSubmitting || requestReset.isPending;

	useEffect(() => {
		setIsSubmitting?.(requestReset.isPending);
	}, [requestReset.isPending, setIsSubmitting]);

	const submitForgotPassword = async () => {
		const parseResult = forgotPasswordSchema.safeParse({
			email: email.trim().toLowerCase(),
		});
		if (!parseResult.success) {
			setEmailError(parseResult.error.flatten().fieldErrors.email?.[0] ?? null);
			return;
		}
		setEmailError(null);

		try {
			await requestReset.mutateAsync({ email: parseResult.data.email });
			toast.success("Password reset email sent");
			window.location.assign("/login");
		} catch (error) {
			toast.error(
				getAuthErrorMessage(error, "Failed to request password reset.")
			);
		}
	};

	return (
		<ClientAuthForm
			className={`grid w-full gap-6 ${className ?? ""}`}
			onSubmit={(event) => {
				event.preventDefault();
				submitForgotPassword().catch((error) => {
					toast.error(
						getAuthErrorMessage(error, "Failed to request password reset.")
					);
				});
			}}
		>
			<div className="space-y-2">
				<Label>Email</Label>
				<Input
					aria-invalid={toAriaInvalid(emailError)}
					disabled={pending}
					onChange={(event) => {
						setEmail(event.target.value);
						if (emailError) {
							setEmailError(null);
						}
					}}
					placeholder="Email"
					type="email"
					value={email}
				/>
				{emailError ? (
					<p className="text-destructive text-xs">{emailError}</p>
				) : null}
			</div>

			<SpinnerButton
				buttonState={pending ? "loading" : "idle"}
				className="w-full text-md"
				disabled={pending}
				isLoading={pending}
				type="submit"
			>
				Send Reset Email
			</SpinnerButton>
		</ClientAuthForm>
	);
}
